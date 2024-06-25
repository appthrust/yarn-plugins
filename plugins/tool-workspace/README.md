# @appthrust/yarn-plugin-tool-workspace

A Yarn plugin to implement the Tool Workspace pattern, reducing the risk of phantom dependencies in your project.

## Requirements

Tested with Yarn v4.3.1, but likely compatible with earlier versions.

## The Problem: Development Tools and Phantom Dependencies Risk

Modern TypeScript projects often require numerous development tools such as TypeScript, ESLint, Prettier, and more. For example:

```shell
yarn add -D typescript eslint prettier husky lint-staged stylelint tsx @commitlint/cli secretlint
```

This command can create over 300 directories in the root `node_modules`. Having many packages unrelated to production code in the top-level workspace's `node_modules` increases the risk of [phantom dependencies](https://rushjs.io/pages/advanced/phantom_deps/).

## The Solution: Tool Workspace Pattern

The Tool Workspace pattern addresses this risk by creating a `tool` directory in the workspace root and installing development tools there. This approach effectively avoids phantom dependencies.

Directory structure example:

```
.
├── packages
│   └── my-product
│       ├── package.json
│       └── node_modules ... (production code dependencies)
└── tool
    ├── package.json
    └── node_modules ... (development tools packages)
```

In this pattern, the workspace root's `node_modules` remains essentially empty, making it immediately clear that there's no risk of phantom dependencies.

## Plugin Features

This plugin facilitates the Tool Workspace pattern with the following features:

- Prevents installation of dependencies in the top-level workspace when using `yarn add`.
- Automatically installs packages into the `tool` workspace instead.
- Ensures that `dependencies`, `devDependencies`, and `peerDependencies` in the top-level workspace's `package.json` remain empty.

## Installation

Install the plugin using the following command:

```shell
yarn plugin import https://raw.githubusercontent.com/appthrust/yarn-plugins/main/plugins/tool-workspace/bundles/%40yarnpkg/plugin-tool-workspace.js
```

## Configuration

Configure the plugin in your project's `.yarnrc.yml`:

| Key             | Type       | Description                                                                                                                                                                                                   | Default Value     |
|-----------------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------|
| `toolWorkspace` | `string`   | Name of the workspace where tool packages will be installed                                                                                                                                                   | `@yourscope/tool` |
| `topLevelTools` | `string[]` | Package names allowed to be installed in the top-level workspace. For example, `["git-cz", "@commitlint/cli"]` allows these packages to be installed in the top-level workspace instead of the tool workspace | `[]`              |

## Executables Hoisting

While the Tool Workspace pattern reduces phantom dependency risks, it can make tool executables less accessible. To address this, the plugin provides a feature to link executables to the workspace root's `node_modules/.bin`.

When a tool is installed in the tool workspace, its executable path is added to the `bin` field in the workspace root's `package.json`. For example:

```json
{
    "name": "workspace-root",
    "workspaces": [
       "plugins/*",
       "tools/*"
    ],
    "bin": {
       "biome": "tools/toolbox/node_modules/@biomejs/biome/bin/biome",
       "tsc": "tools/toolbox/node_modules/typescript/bin/tsc",
       "tsserver": "tools/toolbox/node_modules/typescript/bin/tsserver"
    }
}
```

The plugin then automatically re-runs `yarn install`, allowing Yarn to create symbolic links to these executables. This ensures that tools remain accessible from anywhere in the workspace, preserving the convenience of `yarn run -T <command>` and IDE autodetection.
