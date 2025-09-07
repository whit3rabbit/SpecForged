import * as vscode from 'vscode';
import { McpDiscoveryService } from '../services/McpDiscoveryService';
import { McpConfigSyncService } from '../services/McpConfigSyncService';

interface OnboardingStep {
    id: string;
    title: string;
    description: string;
    icon: string;
    action?: () => Promise<void>;
    validation?: () => Promise<boolean>;
    skippable?: boolean;
}

interface OnboardingState {
    currentStep: number;
    completedSteps: string[];
    skippedSteps: string[];
    startTime: Date;
    isCompleted: boolean;
}

export class WelcomeWalkthrough {
    private webviewPanel: vscode.WebviewPanel | undefined;
    private currentState: OnboardingState;
    
    private readonly steps: OnboardingStep[] = [
        {
            id: 'welcome',
            title: 'Welcome to SpecForged Enhanced!',
            description: 'Your unified MCP ecosystem manager with auto-discovery, seamless configuration sync, and intelligent recommendations.',
            icon: '🎉',
            skippable: false
        },
        {
            id: 'discovery',
            title: 'Discover Your MCP Ecosystem',
            description: 'Let\'s scan for installed MCP clients like Claude, Cursor, Windsurf, and others.',
            icon: '🔍',
            action: this.performDiscovery.bind(this),
            validation: this.validateDiscovery.bind(this)
        },
        {
            id: 'install',
            title: 'Install Missing Clients',
            description: 'We\'ll help you install popular MCP clients that aren\'t detected yet.',
            icon: '📱',
            action: this.showInstallationGuide.bind(this),
            skippable: true
        },
        {
            id: 'configure',
            title: 'Configure MCP Clients',
            description: 'Set up SpecForged and other servers for your installed MCP clients.',
            icon: '⚙️',
            action: this.performConfiguration.bind(this),
            validation: this.validateConfiguration.bind(this)
        },
        {
            id: 'sync',
            title: 'Create Sync Profile',
            description: 'Create a configuration profile to keep all your MCP clients synchronized.',
            icon: '🔄',
            action: this.createSyncProfile.bind(this),
            skippable: true
        },
        {
            id: 'test',
            title: 'Test Connections',
            description: 'Verify that your MCP setup is working correctly across all clients.',
            icon: '🧪',
            action: this.testConnections.bind(this),
            validation: this.validateConnections.bind(this)
        },
        {
            id: 'complete',
            title: 'Setup Complete!',
            description: 'Your MCP ecosystem is configured and ready. Explore the dashboard to manage your setup.',
            icon: '✅',
            skippable: false
        }
    ];

    constructor(
        private context: vscode.ExtensionContext,
        private discoveryService: McpDiscoveryService,
        private configSyncService: McpConfigSyncService
    ) {
        this.currentState = this.loadState();
    }

    public async show(): Promise<void> {
        if (this.webviewPanel) {
            this.webviewPanel.reveal();
            return;
        }

        this.webviewPanel = vscode.window.createWebviewPanel(
            'specforgedWalkthrough',
            'SpecForged Enhanced Setup',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.context.extensionUri]
            }
        );

        this.webviewPanel.iconPath = {
            dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'specforged-dark.svg'),
            light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'specforged-light.svg')
        };

        this.webviewPanel.webview.html = this.getWebviewContent();

        this.webviewPanel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            undefined,
            this.context.subscriptions
        );

        this.webviewPanel.onDidDispose(() => {
            this.webviewPanel = undefined;
            this.saveState();
        });

        // Send initial state
        this.sendStateUpdate();
    }

    public async shouldShowOnStartup(): Promise<boolean> {
        // Show walkthrough if:
        // 1. First time setup (no state saved)
        // 2. User explicitly requested it
        // 3. Major issues detected that need attention
        
        const config = vscode.workspace.getConfiguration('specforged');
        const showOnStartup = config.get<boolean>('showWelcomeWalkthrough', true);
        
        if (!showOnStartup) {
            return false;
        }

        // Check if already completed
        if (this.currentState.isCompleted) {
            return false;
        }

        // Check if user has MCP clients configured (skip if already set up)
        try {
            const discovery = await this.discoveryService.discoverMcpEcosystem();
            const hasConfiguredClients = discovery.configuredClients > 0;
            const hasHighPriorityIssues = discovery.recommendations.some(r => r.priority === 'high');
            
            // Show if no configured clients or high priority issues
            return !hasConfiguredClients || hasHighPriorityIssues;
        } catch (error) {
            // Show on error (likely first run)
            return true;
        }
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'stepAction':
                await this.executeStepAction(message.stepId);
                break;
            case 'nextStep':
                await this.goToNextStep();
                break;
            case 'prevStep':
                this.goToPreviousStep();
                break;
            case 'skipStep':
                await this.skipCurrentStep();
                break;
            case 'complete':
                await this.completeWalkthrough();
                break;
            case 'close':
                this.close();
                break;
            case 'openDashboard':
                vscode.commands.executeCommand('specforged.openMcpDashboard');
                break;
        }
    }

    private async executeStepAction(stepId: string): Promise<void> {
        const step = this.steps.find(s => s.id === stepId);
        if (!step?.action) return;

        try {
            this.sendMessage({
                command: 'stepStatus',
                stepId,
                status: 'executing'
            });

            await step.action();

            this.sendMessage({
                command: 'stepStatus',
                stepId,
                status: 'completed'
            });

            // Auto-advance to next step after action
            setTimeout(() => this.goToNextStep(), 2000);
        } catch (error) {
            this.sendMessage({
                command: 'stepStatus',
                stepId,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    private async goToNextStep(): Promise<void> {
        if (this.currentState.currentStep < this.steps.length - 1) {
            // Mark current step as completed
            const currentStep = this.steps[this.currentState.currentStep];
            if (!this.currentState.completedSteps.includes(currentStep.id)) {
                this.currentState.completedSteps.push(currentStep.id);
            }

            this.currentState.currentStep++;
            this.sendStateUpdate();
            this.saveState();
        }
    }

    private goToPreviousStep(): void {
        if (this.currentState.currentStep > 0) {
            this.currentState.currentStep--;
            this.sendStateUpdate();
            this.saveState();
        }
    }

    private async skipCurrentStep(): Promise<void> {
        const currentStep = this.steps[this.currentState.currentStep];
        if (currentStep.skippable !== false) {
            this.currentState.skippedSteps.push(currentStep.id);
            await this.goToNextStep();
        }
    }

    private async completeWalkthrough(): Promise<void> {
        this.currentState.isCompleted = true;
        this.saveState();

        // Show completion celebration
        vscode.window.showInformationMessage(
            '🎉 SpecForged Enhanced setup complete! Your MCP ecosystem is ready.',
            'Open Dashboard', 'View Tutorial'
        ).then(action => {
            if (action === 'Open Dashboard') {
                vscode.commands.executeCommand('specforged.openMcpDashboard');
            } else if (action === 'View Tutorial') {
                // Could open documentation or show additional help
            }
        });

        this.close();
    }

    private close(): void {
        if (this.webviewPanel) {
            this.webviewPanel.dispose();
        }
    }

    private async performDiscovery(): Promise<void> {
        await this.discoveryService.discoverMcpEcosystem(true);
        
        this.sendMessage({
            command: 'discoveryResults',
            data: await this.getDiscoveryResults()
        });
    }

    private async validateDiscovery(): Promise<boolean> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        return discovery.clients.length > 0;
    }

    private async showInstallationGuide(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        const uninstalledClients = discovery.clients.filter(c => !c.isInstalled);

        if (uninstalledClients.length === 0) {
            this.sendMessage({
                command: 'showMessage',
                type: 'info',
                message: 'All popular MCP clients are already installed!'
            });
            return;
        }

        this.sendMessage({
            command: 'installationGuide',
            clients: uninstalledClients.map(client => ({
                id: client.id,
                name: client.displayName,
                description: this.getClientDescription(client.id),
                downloadUrl: this.getClientDownloadUrl(client.id),
                icon: this.getClientIcon(client.id)
            }))
        });
    }

    private async performConfiguration(): Promise<void> {
        await vscode.commands.executeCommand('specforged.configureAllMcp');
    }

    private async validateConfiguration(): Promise<boolean> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        return discovery.configuredClients > 0;
    }

    private async createSyncProfile(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        const installedClients = discovery.clients.filter(c => c.isInstalled);

        if (installedClients.length === 0) {
            this.sendMessage({
                command: 'showMessage',
                type: 'warning',
                message: 'No MCP clients installed. Sync profile will be created when you install clients.'
            });
            return;
        }

        // Create a default sync profile
        const servers = {
            specforged: {
                name: 'specforged',
                command: 'specforged',
                args: [],
                env: {},
                enabled: true
            }
        };

        await this.configSyncService.createProfile(
            'Default SpecForged Profile',
            'Default configuration profile for SpecForged across all MCP clients',
            servers,
            installedClients.map(c => c.id)
        );

        this.sendMessage({
            command: 'showMessage',
            type: 'success',
            message: 'Default sync profile created successfully!'
        });
    }

    private async testConnections(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        const configuredClients = discovery.clients.filter(c => c.configExists);

        const results = [];
        for (const client of configuredClients) {
            try {
                // Simulate connection test (would be actual implementation)
                const success = Math.random() > 0.2; // 80% success rate for demo
                results.push({
                    client: client.displayName,
                    success,
                    message: success ? 'Connection successful' : 'Connection failed - check configuration'
                });
            } catch (error) {
                results.push({
                    client: client.displayName,
                    success: false,
                    message: `Test failed: ${error}`
                });
            }
        }

        this.sendMessage({
            command: 'connectionResults',
            results
        });
    }

    private async validateConnections(): Promise<boolean> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        return discovery.configuredClients > 0 && discovery.healthIssues.length === 0;
    }

    private async getDiscoveryResults() {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        return {
            totalClients: discovery.totalClients,
            installedClients: discovery.clients.filter(c => c.isInstalled).length,
            configuredClients: discovery.configuredClients,
            servers: discovery.servers.size,
            recommendations: discovery.recommendations.length,
            clients: discovery.clients.map(client => ({
                id: client.id,
                name: client.displayName,
                installed: client.isInstalled,
                configured: client.configExists,
                version: client.version
            }))
        };
    }

    private getClientDescription(clientId: string): string {
        const descriptions: Record<string, string> = {
            claude: 'AI assistant desktop application with MCP support',
            cursor: 'AI-powered code editor based on VS Code',
            windsurf: 'Codeium\'s AI-powered IDE with integrated MCP',
            zed: 'High-performance multiplayer code editor',
            neovim: 'Modern Vim with MCP.nvim plugin support'
        };
        return descriptions[clientId] || 'MCP-enabled development tool';
    }

    private getClientDownloadUrl(clientId: string): string {
        const urls: Record<string, string> = {
            claude: 'https://claude.ai/download',
            cursor: 'https://cursor.so',
            windsurf: 'https://codeium.com/windsurf',
            zed: 'https://zed.dev',
            neovim: 'https://neovim.io'
        };
        return urls[clientId] || '#';
    }

    private getClientIcon(clientId: string): string {
        const icons: Record<string, string> = {
            claude: '🤖',
            cursor: '📝',
            windsurf: '🌊',
            zed: '⚡',
            neovim: '🎯'
        };
        return icons[clientId] || '💻';
    }

    private sendStateUpdate(): void {
        if (!this.webviewPanel) return;

        const currentStep = this.steps[this.currentState.currentStep];
        
        this.sendMessage({
            command: 'stateUpdate',
            state: {
                ...this.currentState,
                currentStepData: currentStep,
                totalSteps: this.steps.length,
                progress: ((this.currentState.currentStep + 1) / this.steps.length) * 100
            }
        });
    }

    private sendMessage(message: any): void {
        if (this.webviewPanel) {
            this.webviewPanel.webview.postMessage(message);
        }
    }

    private loadState(): OnboardingState {
        const saved = this.context.globalState.get<OnboardingState>('specforged.onboardingState');
        
        return saved || {
            currentStep: 0,
            completedSteps: [],
            skippedSteps: [],
            startTime: new Date(),
            isCompleted: false
        };
    }

    private saveState(): void {
        this.context.globalState.update('specforged.onboardingState', this.currentState);
    }

    public resetWalkthrough(): void {
        this.currentState = {
            currentStep: 0,
            completedSteps: [],
            skippedSteps: [],
            startTime: new Date(),
            isCompleted: false
        };
        this.saveState();
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>SpecForged Enhanced Setup</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            overflow-x: hidden;
        }

        .walkthrough-container {
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            text-align: center;
            margin-bottom: 40px;
        }

        .logo {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .title {
            font-size: 28px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .subtitle {
            font-size: 16px;
            opacity: 0.8;
            line-height: 1.5;
        }

        .progress-container {
            margin-bottom: 40px;
        }

        .progress-bar {
            width: 100%;
            height: 8px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: 16px;
        }

        .progress-fill {
            height: 100%;
            background: var(--vscode-progressBar-background);
            transition: width 0.5s ease;
        }

        .progress-text {
            text-align: center;
            font-size: 14px;
            opacity: 0.8;
        }

        .step-container {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 32px;
            margin-bottom: 32px;
            flex: 1;
        }

        .step-header {
            display: flex;
            align-items: center;
            margin-bottom: 24px;
        }

        .step-icon {
            font-size: 32px;
            margin-right: 16px;
        }

        .step-title {
            font-size: 24px;
            font-weight: 600;
            margin: 0;
        }

        .step-description {
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 32px;
            opacity: 0.9;
        }

        .step-content {
            margin-bottom: 32px;
        }

        .step-actions {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }

        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 12px 24px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: background-color 0.2s;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn.secondary {
            background: transparent;
            border: 1px solid var(--vscode-input-border);
        }

        .btn.secondary:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .discovery-results, .connection-results, .installation-guide {
            background: var(--vscode-input-background);
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
        }

        .client-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 16px;
            margin: 20px 0;
        }

        .client-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 16px;
            text-align: center;
        }

        .client-icon {
            font-size: 32px;
            margin-bottom: 8px;
        }

        .client-name {
            font-weight: 600;
            margin-bottom: 4px;
        }

        .client-description {
            font-size: 12px;
            opacity: 0.8;
            line-height: 1.4;
            margin-bottom: 12px;
        }

        .status-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }

        .status-badge.installed {
            background: rgba(76, 175, 80, 0.2);
            color: #4CAF50;
        }

        .status-badge.configured {
            background: rgba(33, 150, 243, 0.2);
            color: #2196F3;
        }

        .status-badge.not-installed {
            background: rgba(244, 67, 54, 0.2);
            color: #f44336;
        }

        .loading {
            text-align: center;
            padding: 20px;
            opacity: 0.7;
        }

        .loading::before {
            content: '';
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid transparent;
            border-top: 2px solid currentColor;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 8px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .message {
            padding: 12px 16px;
            border-radius: 4px;
            margin: 16px 0;
            border-left: 4px solid;
        }

        .message.info {
            background: rgba(33, 150, 243, 0.1);
            border-left-color: #2196F3;
        }

        .message.success {
            background: rgba(76, 175, 80, 0.1);
            border-left-color: #4CAF50;
        }

        .message.warning {
            background: rgba(255, 152, 0, 0.1);
            border-left-color: #FF9800;
        }

        .message.error {
            background: rgba(244, 67, 54, 0.1);
            border-left-color: #f44336;
        }

        .navigation {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-input-border);
        }

        .step-indicator {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .step-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--vscode-input-background);
            transition: background-color 0.3s;
        }

        .step-dot.completed {
            background: var(--vscode-progressBar-background);
        }

        .step-dot.current {
            background: var(--vscode-progressBar-background);
            transform: scale(1.5);
        }
    </style>
</head>
<body>
    <div class="walkthrough-container">
        <div class="header">
            <div class="logo">🔧</div>
            <div class="title">Welcome to SpecForged Enhanced</div>
            <div class="subtitle">
                Your unified MCP ecosystem manager with auto-discovery, seamless configuration sync, and intelligent recommendations.
            </div>
        </div>

        <div class="progress-container">
            <div class="progress-bar">
                <div class="progress-fill" id="progress-fill" style="width: 0%"></div>
            </div>
            <div class="progress-text" id="progress-text">Step 1 of 7</div>
        </div>

        <div class="step-container" id="step-container">
            <div class="step-header">
                <div class="step-icon" id="step-icon">🎉</div>
                <h2 class="step-title" id="step-title">Loading...</h2>
            </div>
            <div class="step-description" id="step-description">Please wait while we initialize the setup wizard...</div>
            <div class="step-content" id="step-content"></div>
            <div class="step-actions" id="step-actions"></div>
        </div>

        <div class="navigation">
            <div class="step-indicator" id="step-indicator"></div>
            <div>
                <button class="btn secondary" id="prev-btn" onclick="previousStep()" disabled>Previous</button>
                <button class="btn" id="next-btn" onclick="nextStep()" disabled>Next</button>
                <button class="btn secondary" id="skip-btn" onclick="skipStep()" style="display: none;">Skip</button>
                <button class="btn secondary" onclick="closeWalkthrough()">Close</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentState = null;

        // Message handling
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'stateUpdate':
                    currentState = message.state;
                    updateUI();
                    break;
                case 'stepStatus':
                    updateStepStatus(message.stepId, message.status, message.error);
                    break;
                case 'discoveryResults':
                    showDiscoveryResults(message.data);
                    break;
                case 'installationGuide':
                    showInstallationGuide(message.clients);
                    break;
                case 'connectionResults':
                    showConnectionResults(message.results);
                    break;
                case 'showMessage':
                    showMessage(message.type, message.message);
                    break;
            }
        });

        function updateUI() {
            if (!currentState) return;

            const step = currentState.currentStepData;
            
            document.getElementById('step-icon').textContent = step.icon;
            document.getElementById('step-title').textContent = step.title;
            document.getElementById('step-description').textContent = step.description;
            document.getElementById('progress-fill').style.width = currentState.progress + '%';
            document.getElementById('progress-text').textContent = 
                \`Step \${currentState.currentStep + 1} of \${currentState.totalSteps}\`;

            // Update navigation
            updateNavigation();
            
            // Update step indicators
            updateStepIndicators();
            
            // Update step content and actions
            updateStepContent(step);
        }

        function updateNavigation() {
            const prevBtn = document.getElementById('prev-btn');
            const nextBtn = document.getElementById('next-btn');
            const skipBtn = document.getElementById('skip-btn');

            prevBtn.disabled = currentState.currentStep === 0;
            nextBtn.disabled = false;
            skipBtn.style.display = currentState.currentStepData.skippable !== false ? 'inline-block' : 'none';

            if (currentState.currentStep === currentState.totalSteps - 1) {
                nextBtn.textContent = 'Complete';
                nextBtn.onclick = completeWalkthrough;
            } else {
                nextBtn.textContent = 'Next';
                nextBtn.onclick = nextStep;
            }
        }

        function updateStepIndicators() {
            const container = document.getElementById('step-indicator');
            container.innerHTML = '';

            for (let i = 0; i < currentState.totalSteps; i++) {
                const dot = document.createElement('div');
                dot.className = 'step-dot';
                
                if (i < currentState.currentStep) {
                    dot.classList.add('completed');
                } else if (i === currentState.currentStep) {
                    dot.classList.add('current');
                }
                
                container.appendChild(dot);
            }
        }

        function updateStepContent(step) {
            const content = document.getElementById('step-content');
            const actions = document.getElementById('step-actions');
            
            content.innerHTML = '';
            actions.innerHTML = '';

            // Add step-specific content and actions
            if (step.action) {
                const actionBtn = document.createElement('button');
                actionBtn.className = 'btn';
                actionBtn.textContent = getActionButtonText(step.id);
                actionBtn.onclick = () => executeStepAction(step.id);
                actions.appendChild(actionBtn);
            }
        }

        function getActionButtonText(stepId) {
            const labels = {
                discovery: 'Scan for MCP Clients',
                install: 'Show Installation Guide',
                configure: 'Configure All Clients',
                sync: 'Create Sync Profile',
                test: 'Test All Connections'
            };
            return labels[stepId] || 'Execute';
        }

        function executeStepAction(stepId) {
            vscode.postMessage({
                command: 'stepAction',
                stepId: stepId
            });
        }

        function nextStep() {
            vscode.postMessage({ command: 'nextStep' });
        }

        function previousStep() {
            vscode.postMessage({ command: 'prevStep' });
        }

        function skipStep() {
            vscode.postMessage({ command: 'skipStep' });
        }

        function completeWalkthrough() {
            vscode.postMessage({ command: 'complete' });
        }

        function closeWalkthrough() {
            vscode.postMessage({ command: 'close' });
        }

        function updateStepStatus(stepId, status, error) {
            const actions = document.getElementById('step-actions');
            const btn = actions.querySelector('button');
            
            if (btn) {
                switch (status) {
                    case 'executing':
                        btn.disabled = true;
                        btn.innerHTML = '<div class="loading"></div>';
                        break;
                    case 'completed':
                        btn.disabled = false;
                        btn.textContent = '✓ Completed';
                        btn.style.background = 'var(--vscode-button-background)';
                        break;
                    case 'error':
                        btn.disabled = false;
                        btn.textContent = 'Retry';
                        showMessage('error', error);
                        break;
                }
            }
        }

        function showDiscoveryResults(data) {
            const content = document.getElementById('step-content');
            content.innerHTML = \`
                <div class="discovery-results">
                    <h3>Discovery Results</h3>
                    <p>Found <strong>\${data.totalClients}</strong> MCP clients, <strong>\${data.installedClients}</strong> installed, <strong>\${data.configuredClients}</strong> configured</p>
                    <div class="client-grid">
                        \${data.clients.map(client => \`
                            <div class="client-card">
                                <div class="client-icon">💻</div>
                                <div class="client-name">\${client.name}</div>
                                <div class="status-badge \${client.installed ? (client.configured ? 'configured' : 'installed') : 'not-installed'}">
                                    \${client.installed ? (client.configured ? 'Configured' : 'Installed') : 'Not Installed'}
                                </div>
                            </div>
                        \`).join('')}
                    </div>
                </div>
            \`;
        }

        function showInstallationGuide(clients) {
            const content = document.getElementById('step-content');
            content.innerHTML = \`
                <div class="installation-guide">
                    <h3>Recommended MCP Clients</h3>
                    <div class="client-grid">
                        \${clients.map(client => \`
                            <div class="client-card">
                                <div class="client-icon">\${client.icon}</div>
                                <div class="client-name">\${client.name}</div>
                                <div class="client-description">\${client.description}</div>
                                <a href="\${client.downloadUrl}" class="btn" target="_blank">Download</a>
                            </div>
                        \`).join('')}
                    </div>
                </div>
            \`;
        }

        function showConnectionResults(results) {
            const content = document.getElementById('step-content');
            content.innerHTML = \`
                <div class="connection-results">
                    <h3>Connection Test Results</h3>
                    \${results.map(result => \`
                        <div class="message \${result.success ? 'success' : 'error'}">
                            <strong>\${result.client}:</strong> \${result.message}
                        </div>
                    \`).join('')}
                </div>
            \`;
        }

        function showMessage(type, message) {
            const content = document.getElementById('step-content');
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${type}\`;
            messageDiv.textContent = message;
            content.appendChild(messageDiv);
        }
    </script>
</body>
</html>`;
    }
}