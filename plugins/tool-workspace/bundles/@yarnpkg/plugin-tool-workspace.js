/* eslint-disable */
//prettier-ignore
module.exports = {
	name: "@yarnpkg/plugin-tool-workspace",
	factory: function (require) {
		var plugin = (() => {
			var __create = Object.create;
			var __defProp = Object.defineProperty;
			var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
			var __getOwnPropNames = Object.getOwnPropertyNames;
			var __getProtoOf = Object.getPrototypeOf;
			var __hasOwnProp = Object.prototype.hasOwnProperty;
			var __require = /* @__PURE__ */ ((x) =>
				typeof require !== "undefined"
					? require
					: typeof Proxy !== "undefined"
						? new Proxy(x, {
								get: (a, b) => (typeof require !== "undefined" ? require : a)[b],
							})
						: x)(function (x) {
				if (typeof require !== "undefined") return require.apply(this, arguments);
				throw new Error('Dynamic require of "' + x + '" is not supported');
			});
			var __export = (target, all) => {
				for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
			};
			var __copyProps = (to, from, except, desc) => {
				if ((from && typeof from === "object") || typeof from === "function") {
					for (let key of __getOwnPropNames(from))
						if (!__hasOwnProp.call(to, key) && key !== except)
							__defProp(to, key, {
								get: () => from[key],
								enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
							});
				}
				return to;
			};
			var __toESM = (mod, isNodeMode, target) => (
				(target = mod != null ? __create(__getProtoOf(mod)) : {}),
				__copyProps(
					isNodeMode || !mod || !mod.__esModule
						? __defProp(target, "default", { value: mod, enumerable: true })
						: target,
					mod,
				)
			);
			var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

			// sources/index.ts
			var sources_exports = {};
			__export(sources_exports, {
				default: () => sources_default,
			});
			var import_core = __require("@yarnpkg/core");
			var import_fslib = __require("@yarnpkg/fslib");
			var pluginName = "plugin-tool-workspace";
			var movedDependencies = [];
			var plugin = {
				configuration: {
					toolWorkspace: {
						description: `[${pluginName}] The workspace name to install tool packages`,
						type: import_core.SettingsType.STRING,
						isNullable: true,
						default: void 0,
					},
					topLevelTools: {
						description: `[${pluginName}] List of package names that are allowed to be installed in the top level workspace`,
						type: import_core.SettingsType.STRING,
						isArray: true,
						default: [],
					},
				},
				hooks: {
					validateProject: (project, { reportError }) => {
						const nmHoistingLimits = project.configuration.get("nmHoistingLimits");
						if (nmHoistingLimits !== "workspaces" && nmHoistingLimits !== "dependencies") {
							const code = (value) =>
								import_core.formatUtils.pretty(project.configuration, value, import_core.formatUtils.Type.CODE);
							const banner = import_core.formatUtils.pretty(
								project.configuration,
								`[${pluginName}]`,
								import_core.formatUtils.Type.ID,
							);
							reportError(
								import_core.MessageName.INVALID_CONFIGURATION_VALUE,
								`${banner} The configuration ${code("nmHoistingLimits")} must be either "${code("workspaces")}" or "${code("dependencies")}".`,
							);
							return;
						}
						const result = checkIfTopLevelWorkspaceIsClean(project);
						if (result.ok) {
							return;
						}
						const pretty = import_core.structUtils.prettyIdent.bind(null, project.configuration);
						if (result.err === "toolWorkspaceNotFound") {
							const { toolWorkspaceIdent } = result;
							reportError(
								import_core.MessageName.UNNAMED,
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
								import_core.MessageName.CONSTRAINTS_INVALID_DEPENDENCY,
								`The package ${invalidDependencies} ${are} not allowed to be installed in the top level workspace${name ? ` ${pretty(name)}` : ""}. Please move them to the tool workspace ${pretty(toolWorkspaceIdent)} if it is a tool package.`,
							);
						}
						reportError(import_core.MessageName.UNNAMED, "Something went wrong");
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
							const pretty = import_core.structUtils.prettyIdent.bind(null, workspace.project.configuration);
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
			var sources_default = plugin;
			function checkIfTopLevelWorkspaceIsClean(project) {
				const { configuration, topLevelWorkspace } = project;
				const toolWorkspace = findToolWorkspace(project);
				if (!toolWorkspace) {
					const ident = getToolWorkspaceIdent(configuration, topLevelWorkspace);
					return { ok: false, err: "toolWorkspaceNotFound", toolWorkspaceIdent: ident };
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
					return { ok: false, err: "disallowedDependencies", disallowedDependencies, toolWorkspaceIdent: ident };
				}
				return { ok: true };
			}
			function getTopLevelToolIdents(configuration) {
				const topLevelTools = configuration.get("topLevelTools");
				return topLevelTools.map(import_core.structUtils.parseIdent);
			}
			function checkDependencies(dependencies, topLevelToolIdents) {
				const allowed = isTopLevelTool.bind(null, topLevelToolIdents);
				const disallowedIdents = /* @__PURE__ */ new Map();
				for (const [identHash, descriptor] of dependencies) {
					if (!allowed(descriptor)) {
						disallowedIdents.set(identHash, descriptor);
					}
				}
				return disallowedIdents;
			}
			function isTopLevelTool(topLevelToolIdents, dependency) {
				for (const topLevelToolIdent of topLevelToolIdents) {
					if (topLevelToolIdent.identHash === dependency.identHash) {
						return true;
					}
				}
				return false;
			}
			function findToolWorkspace(project) {
				const toolWorkspaceIdent = getToolWorkspaceIdent(project.configuration, project.topLevelWorkspace);
				return project.workspacesByIdent.get(toolWorkspaceIdent.identHash);
			}
			function getToolWorkspaceIdent(configuration, topLevelWorkspace) {
				const toolWorkspaceRawName = configuration.get("toolWorkspace");
				if (!toolWorkspaceRawName) {
					return inferToolWorkspaceIdent(topLevelWorkspace);
				}
				return import_core.structUtils.parseIdent(toolWorkspaceRawName);
			}
			function inferToolWorkspaceIdent(topLevelWorkspace) {
				const { name } = topLevelWorkspace.manifest;
				return name
					? import_core.structUtils.makeIdent(name.scope, "tool")
					: import_core.structUtils.makeIdent(null, "tool");
			}
			function moveDependencyToToolWorkspace(workspace, target, descriptor) {
				const { project } = workspace;
				if (workspace !== project.topLevelWorkspace) {
					return { type: "noop" };
				}
				const { configuration } = project;
				const topLevelToolIdents = getTopLevelToolIdents(configuration);
				if (isTopLevelTool(topLevelToolIdents, descriptor)) {
					return { type: "topLevelTool" };
				}
				const toolWorkspace = findToolWorkspace(project);
				const toolWorkspaceIdent = getToolWorkspaceIdent(configuration, workspace);
				if (!toolWorkspace) {
					return { type: "toolWorkspaceNotFound", toolWorkspaceIdent };
				}
				workspace.manifest[target].delete(descriptor.identHash);
				toolWorkspace.manifest[target].set(descriptor.identHash, descriptor);
				return { type: "moved", toolWorkspaceIdent };
			}
			function reportMovedDependencies(project, options) {
				if (movedDependencies.length === 0) {
					return;
				}
				const { report } = options;
				const { configuration, topLevelWorkspace } = project;
				const banner = import_core.formatUtils.pretty(
					configuration,
					`[${pluginName}]`,
					import_core.formatUtils.Type.ID,
				);
				const pretty = import_core.structUtils.prettyIdent.bind(null, configuration);
				const toolWorkspaceIdent = getToolWorkspaceIdent(configuration, topLevelWorkspace);
				const { name } = topLevelWorkspace.manifest;
				const dependencies = movedDependencies
					.map(pretty)
					.join(", ")
					.replace(/, ([^,]*)$/, " and $1");
				const were = movedDependencies.length > 1 ? "were" : "was";
				report.reportInfo(
					import_core.MessageName.UNNAMED,
					`${banner} The package ${dependencies} ${were} installed in the workspace ${pretty(toolWorkspaceIdent)}, instead of the workspace root ${name ? ` ${pretty(name)}` : ""} to keep the workspace root clean.`,
				);
			}
			async function updateTopLevelWorkspaceBins(project, options) {
				const toolWorkspace = findToolWorkspace(project);
				if (!toolWorkspace) {
					return;
				}
				const { topLevelWorkspace } = project;
				const oldBin = Object.fromEntries(topLevelWorkspace.manifest.bin.entries());
				let linksTools = false;
				for (const [name, path] of topLevelWorkspace.manifest.bin) {
					const binPath = import_fslib.ppath.join(topLevelWorkspace.cwd, path);
					const symlinkPath = import_fslib.npath.toPortablePath(
						import_fslib.npath.join(
							import_fslib.npath.fromPortablePath(topLevelWorkspace.cwd),
							"node_modules",
							".bin",
							name,
						),
					);
					if (!import_fslib.xfs.existsSync(binPath)) {
						topLevelWorkspace.manifest.bin.delete(name);
						try {
							import_fslib.xfs.removeSync(symlinkPath);
						} catch {
							options.report.reportWarning(
								import_core.MessageName.UNNAMED,
								`Failed to remove the symlink ${symlinkPath}`,
							);
						}
					}
					if (!import_fslib.xfs.existsSync(symlinkPath)) {
						linksTools = true;
					}
				}
				const bins = await import_core.scriptUtils.getWorkspaceAccessibleBinaries(toolWorkspace);
				for (const [name, [, nativePath]] of bins) {
					const path = import_fslib.ppath.relative(
						topLevelWorkspace.cwd,
						import_fslib.npath.toPortablePath(nativePath),
					);
					topLevelWorkspace.manifest.bin.set(name, path);
				}
				const newBin = Object.fromEntries(topLevelWorkspace.manifest.bin.entries());
				const assert = await import("node:assert/strict");
				const banner = import_core.formatUtils.pretty(
					project.configuration,
					`[${pluginName}]`,
					import_core.formatUtils.Type.ID,
				);
				try {
					assert.deepEqual(newBin, oldBin);
				} catch (error) {
					options.report.reportInfo(
						import_core.MessageName.UNNAMED,
						`${banner} Updating the top level workspace bins.`,
					);
					const diff = error.message.split("\n").slice(3);
					for (const line of diff) {
						options.report.reportInfo(import_core.MessageName.UNNAMED, `${banner} ${line}`);
					}
					linksTools = true;
				}
				if (!linksTools) {
					return;
				}
				options.report.reportInfo(import_core.MessageName.UNNAMED, `${banner} Linking tools.`);
				await topLevelWorkspace.persistManifest();
				await project.linkEverything(options);
			}
			return __toCommonJS(sources_exports);
		})();
		return plugin;
	},
};
