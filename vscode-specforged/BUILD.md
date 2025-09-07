# Building the SpecForged VS Code Extension

This guide covers how to build, test, and package the SpecForged VS Code extension.

## Prerequisites

- Node.js 16+ and npm
- VS Code 1.74.0 or higher
- SpecForged MCP server (`pipx install specforged`)

## Development Setup

1. **Clone and install dependencies:**
   ```bash
   cd vscode-specforged
   npm install
   ```

2. **Compile TypeScript:**
   ```bash
   npm run compile
   ```

   Or watch for changes:
   ```bash
   npm run watch
   ```

3. **Run the extension:**
   - Open the project in VS Code
   - Press `F5` to launch Extension Development Host
   - Test the extension in the new VS Code window

## Testing

Run the test suite:
```bash
npm run test
```

Or run tests from VS Code:
- Open the project in VS Code
- Go to Run and Debug view (`Ctrl+Shift+D`)
- Select "Extension Tests" and press `F5`

## Linting and Formatting

Check code quality:
```bash
npm run lint
```

## Building for Distribution

1. **Install VSCE (VS Code Extension manager):**
   ```bash
   npm install -g @vscode/vsce
   ```

2. **Package the extension:**
   ```bash
   npm run package
   ```

   This creates a `.vsix` file that can be installed in VS Code.

3. **Install the packaged extension:**
   ```bash
   code --install-extension vscode-specforged-0.1.0.vsix
   ```

## Publishing

To publish to the VS Code Marketplace:

1. **Get a Personal Access Token** from Azure DevOps
2. **Login to VSCE:**
   ```bash
   vsce login specforged
   ```

3. **Publish:**
   ```bash
   npm run publish
   ```

## Project Structure

```
vscode-specforged/
├── src/                          # TypeScript source files
│   ├── commands/                 # Command implementations
│   ├── mcp/                      # MCP integration
│   ├── models/                   # Data models
│   ├── providers/                # VS Code tree providers
│   ├── utils/                    # Utility functions
│   ├── views/                    # UI components
│   ├── extension.ts              # Main extension entry point
│   └── test/                     # Test files
├── resources/                    # Static resources
│   ├── icons/                    # Extension icons
│   ├── styles/                   # CSS for webviews
│   └── templates/                # Configuration templates
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # User documentation
```

## Key Files

- **package.json**: Extension manifest with commands, menus, and configuration
- **src/extension.ts**: Main entry point that activates the extension
- **src/providers/specProvider.ts**: Tree view data provider for specifications
- **src/mcp/mcpManager.ts**: Handles MCP server setup and configuration
- **src/views/specWebview.ts**: Rich webview for specification display

## Development Commands

```bash
npm run compile      # Compile TypeScript
npm run watch        # Watch and compile on changes
npm run lint         # Run ESLint
npm run test         # Run test suite
npm run package      # Create VSIX package
npm run publish      # Publish to marketplace
```

## Debugging

1. Set breakpoints in TypeScript files
2. Press `F5` to launch Extension Development Host
3. Breakpoints will be hit when the extension runs
4. Use VS Code's integrated debugger to inspect variables

## Common Issues

### Extension Not Activating
- Check that activation events in package.json are correct
- Ensure the workspace contains `.specifications` folder
- Verify commands are registered properly

### TypeScript Compilation Errors
- Run `npm run compile` to see detailed errors
- Check import paths and type definitions
- Ensure all dependencies are installed

### MCP Server Not Found
- Verify SpecForged is installed: `specforged --version`
- Check PATH includes pipx binary directory
- Test MCP setup wizard in extension

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## Architecture Notes

The extension follows VS Code extension best practices:

- **Lazy activation**: Only activates when specifications are detected
- **Command-driven**: Most functionality accessible via Command Palette
- **Tree provider pattern**: Uses VS Code's built-in tree view system
- **Webview integration**: Rich UI for complex specification display
- **File system watching**: Responds to specification file changes
- **Status bar integration**: Shows current state and progress

## Performance Considerations

- Specifications are parsed on-demand
- File system watching is scoped to specification directories
- Tree view uses lazy loading for large specification sets
- Webviews are disposed when not visible to save memory
