import {
	type Configuration,
	type Hooks as CoreHooks,
	type Descriptor,
	type Ident,
	type IdentHash,
	MessageName,
	type Plugin,
	type Project,
	SettingsType,
	type Workspace,
	formatUtils,
	scriptUtils,
	structUtils,
} from "@yarnpkg/core";
import { npath, ppath, xfs } from "@yarnpkg/fslib";

import type { Hooks as EssentialHooks, suggestUtils } from "@yarnpkg/plugin-essentials";
type InstallOptions = Parameters<Project["install"]>[0];

const pluginName = "plugin-tool-workspace";

const movedDependencies: Descriptor[] = [];

const plugin: Plugin<CoreHooks & EssentialHooks> = {
	configuration: {
		toolWorkspace: {
			description: `[${pluginName}] The workspace name to install tool packages`,
			type: SettingsType.STRING,
			isNullable: true,
			default: undefined,
		},
		topLevelTools: {
			description: `[${pluginName}] List of package names that are allowed to be installed in the top level workspace`,
			type: SettingsType.STRING,
			isArray: true,
			default: [],
		},
	},
	hooks: {
		validateProject: (project, { reportError }) => {
			const nmHoistingLimits = project.configuration.get("nmHoistingLimits");
			if (nmHoistingLimits !== "workspaces" && nmHoistingLimits !== "dependencies") {
				const code = (value: string) => formatUtils.pretty(project.configuration, value, formatUtils.Type.CODE);
				const banner = formatUtils.pretty(project.configuration, `[${pluginName}]`, formatUtils.Type.ID);
				reportError(
					MessageName.INVALID_CONFIGURATION_VALUE,
					`${banner} The configuration ${code("nmHoistingLimits")} must be either "${code("workspaces")}" or "${code("dependencies")}".`,
				);
				return;
			}
			const result = checkIfTopLevelWorkspaceIsClean(project);
			if (result.ok) {
				return;
			}
			const pretty = structUtils.prettyIdent.bind(null, project.configuration);
			if (result.err === "toolWorkspaceNotFound") {
				const { toolWorkspaceIdent } = result;
				reportError(
					MessageName.UNNAMED,
					`[${pluginName}] The tool workspace ${pretty(toolWorkspaceIdent)} not found. Please create it at first.`,
				);
				return;
			}
			if (result.err === "disallowedDependencies") {
				const { topLevelWorkspace } = project;
				const { name } = topLevelWorkspace.manifest;
				const { disallowedDependencies, toolWorkspaceIdent } = result;
				const invalidDependencies = [...disallowedDependencies.values()]
					.map(pretty)
					.join(", ")
					.replace(/, ([^,]*)$/, " and $1");
				const are = invalidDependencies.length > 1 ? "are" : "is";
				reportError(
					MessageName.CONSTRAINTS_INVALID_DEPENDENCY,
					`The package ${invalidDependencies} ${are} not allowed to be installed in the top level workspace${name ? ` ${pretty(name)}` : ""}. Please move them to the tool workspace ${pretty(toolWorkspaceIdent)} if it is a tool package.`,
				);
			}
			reportError(MessageName.UNNAMED, "Something went wrong");
		},
		afterWorkspaceDependencyAddition: async (workspace, target, descriptor) => {
			const result = moveDependencyToToolWorkspace(workspace, target, descriptor);
			if (result.type === "noop") {
				return;
			}
			if (result.type === "topLevelTool") {
				return;
			}
			if (result.type === "toolWorkspaceNotFound") {
				const pretty = structUtils.prettyIdent.bind(null, workspace.project.configuration);
				throw new Error(
					`[${pluginName}] The tool workspace ${pretty(result.toolWorkspaceIdent)} not found. Please create it at first.`,
				);
			}
			movedDependencies.push(descriptor);
		},
		afterAllInstalled: async (project, options) => {
			reportMovedDependencies(project, options);
			await updateTopLevelWorkspaceBins(project, options);
		},
	},
};

export default plugin;

function checkIfTopLevelWorkspaceIsClean(project: Project) /* infer */ {
	const { configuration, topLevelWorkspace } = project;
	const toolWorkspace = findToolWorkspace(project);
	if (!toolWorkspace) {
		const ident = getToolWorkspaceIdent(configuration, topLevelWorkspace);
		return { ok: false, err: "toolWorkspaceNotFound", toolWorkspaceIdent: ident } as const;
	}
	const topLevelToolIdents = getTopLevelToolIdents(configuration);
	const { dependencies, devDependencies, peerDependencies } = topLevelWorkspace.manifest;
	const disallowedDependencies = new Map([
		...checkDependencies(dependencies, topLevelToolIdents),
		...checkDependencies(devDependencies, topLevelToolIdents),
		...checkDependencies(peerDependencies, topLevelToolIdents),
	]);
	if (disallowedDependencies.size > 0) {
		const ident = getToolWorkspaceIdent(configuration, topLevelWorkspace);
		return { ok: false, err: "disallowedDependencies", disallowedDependencies, toolWorkspaceIdent: ident } as const;
	}
	return { ok: true } as const;
}

function getTopLevelToolIdents(configuration: Configuration): Ident[] {
	const topLevelTools = configuration.get("topLevelTools");
	return topLevelTools.map(structUtils.parseIdent);
}

function checkDependencies(
	dependencies: Map<IdentHash, Descriptor>,
	topLevelToolIdents: Ident[],
): Map<IdentHash, Ident> {
	const allowed = isTopLevelTool.bind(null, topLevelToolIdents);
	const disallowedIdents: Map<IdentHash, Ident> = new Map();
	for (const [identHash, descriptor] of dependencies) {
		if (!allowed(descriptor)) {
			disallowedIdents.set(identHash, descriptor);
		}
	}
	return disallowedIdents;
}

function isTopLevelTool(topLevelToolIdents: Ident[], dependency: Ident): boolean {
	for (const topLevelToolIdent of topLevelToolIdents) {
		if (topLevelToolIdent.identHash === dependency.identHash) {
			return true;
		}
	}
	return false;
}

function findToolWorkspace(project: Project): undefined | Workspace {
	const toolWorkspaceIdent = getToolWorkspaceIdent(project.configuration, project.topLevelWorkspace);
	return project.workspacesByIdent.get(toolWorkspaceIdent.identHash);
}

function getToolWorkspaceIdent(configuration: Configuration, topLevelWorkspace: Workspace): Ident {
	const toolWorkspaceRawName = configuration.get("toolWorkspace");
	if (!toolWorkspaceRawName) {
		return inferToolWorkspaceIdent(topLevelWorkspace);
	}
	return structUtils.parseIdent(toolWorkspaceRawName);
}

function inferToolWorkspaceIdent(topLevelWorkspace: Workspace): Ident {
	const { name } = topLevelWorkspace.manifest;
	return name ? structUtils.makeIdent(name.scope, "tool") : structUtils.makeIdent(null, "tool");
}

function moveDependencyToToolWorkspace(
	workspace: Workspace,
	target: suggestUtils.Target,
	descriptor: Descriptor,
) /* infer */ {
	const { project } = workspace;
	if (workspace !== project.topLevelWorkspace) {
		return { type: "noop" } as const;
	}
	const { configuration } = project;
	const topLevelToolIdents = getTopLevelToolIdents(configuration);
	if (isTopLevelTool(topLevelToolIdents, descriptor)) {
		return { type: "topLevelTool" } as const;
	}
	const toolWorkspace = findToolWorkspace(project);
	const toolWorkspaceIdent = getToolWorkspaceIdent(configuration, workspace);
	if (!toolWorkspace) {
		return { type: "toolWorkspaceNotFound", toolWorkspaceIdent } as const;
	}
	workspace.manifest[target].delete(descriptor.identHash); // prevent installing packages in the top level workspace
	toolWorkspace.manifest[target].set(descriptor.identHash, descriptor); // instead, install it in the tool workspace
	return { type: "moved", toolWorkspaceIdent } as const;
}

function reportMovedDependencies(project: Project, options: InstallOptions): void {
	if (movedDependencies.length === 0) {
		return;
	}
	const { report } = options;
	const { configuration, topLevelWorkspace } = project;
	const banner = formatUtils.pretty(configuration, `[${pluginName}]`, formatUtils.Type.ID);
	const pretty = structUtils.prettyIdent.bind(null, configuration);
	const toolWorkspaceIdent = getToolWorkspaceIdent(configuration, topLevelWorkspace);
	const { name } = topLevelWorkspace.manifest;
	const dependencies = movedDependencies
		.map(pretty)
		.join(", ")
		.replace(/, ([^,]*)$/, " and $1");
	const were = movedDependencies.length > 1 ? "were" : "was";
	report.reportInfo(
		MessageName.UNNAMED,
		`${banner} The package ${dependencies} ${were} installed in the workspace ${pretty(toolWorkspaceIdent)}, instead of the workspace root ${name ? ` ${pretty(name)}` : ""} to keep the workspace root clean.`,
	);
}

async function updateTopLevelWorkspaceBins(project: Project, options: InstallOptions): Promise<void> {
	const toolWorkspace = findToolWorkspace(project);
	if (!toolWorkspace) {
		return;
	}
	const { topLevelWorkspace } = project;
	const oldBin = Object.fromEntries(topLevelWorkspace.manifest.bin.entries());
	let linksTools = false;
	for (const [name, path] of topLevelWorkspace.manifest.bin) {
		const binPath = ppath.join(topLevelWorkspace.cwd, path);
		const symlinkPath = npath.toPortablePath(
			npath.join(npath.fromPortablePath(topLevelWorkspace.cwd), "node_modules", ".bin", name),
		);
		if (!xfs.existsSync(binPath)) {
			topLevelWorkspace.manifest.bin.delete(name);
			try {
				xfs.removeSync(symlinkPath);
			} catch {
				options.report.reportWarning(MessageName.UNNAMED, `Failed to remove the symlink ${symlinkPath}`);
			}
		}
		if (!xfs.existsSync(symlinkPath)) {
			linksTools = true;
		}
	}
	const bins = await scriptUtils.getWorkspaceAccessibleBinaries(toolWorkspace);
	for (const [name, [, nativePath]] of bins) {
		const path = ppath.relative(topLevelWorkspace.cwd, npath.toPortablePath(nativePath));
		topLevelWorkspace.manifest.bin.set(name, path);
	}
	const newBin = Object.fromEntries(topLevelWorkspace.manifest.bin.entries());
	const assert = await import("node:assert/strict");
	const banner = formatUtils.pretty(project.configuration, `[${pluginName}]`, formatUtils.Type.ID);
	try {
		// @ts-expect-error
		assert.deepEqual(newBin, oldBin);
	} catch (error) {
		options.report.reportInfo(MessageName.UNNAMED, `${banner} Updating the top level workspace bins.`);
		const diff = (error as import("node:assert/strict").AssertionError).message.split("\n").slice(3);
		for (const line of diff) {
			options.report.reportInfo(MessageName.UNNAMED, `${banner} ${line}`);
		}
		linksTools = true;
	}
	if (!linksTools) {
		return;
	}
	options.report.reportInfo(MessageName.UNNAMED, `${banner} Linking tools.`);
	await topLevelWorkspace.persistManifest();
	await project.linkEverything(options);
}

declare module "@yarnpkg/core" {
	interface ConfigurationValueMap {
		toolWorkspace: string | undefined;
		topLevelTools: string[];
	}
}
