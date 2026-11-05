import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { tabs_title } from '@/constants/bot-contents';
import { getSavedWorkspaces, onWorkspaceResize } from '@/external/bot-skeleton';
import { getSetting, storeSetting } from '@/utils/settings';
import RootStore from './root-store';

export default class BlocklyStore {
    root_store: RootStore;

    is_loading = false;
    is_workspace_ready = false;
    startup_progress = 0;
    startup_message = 'Preparing Blockly workspace...';
    active_tab = tabs_title.WORKSPACE;
    _has_saved_bots = false;

    private is_mounted = false;

    constructor(root_store: RootStore) {
        this.root_store = root_store;

        makeObservable(this, {
            is_loading: observable,
            is_workspace_ready: observable,
            startup_progress: observable,
            startup_message: observable,
            active_tab: observable,
            _has_saved_bots: observable,
            has_active_bot: computed,
            has_saved_bots: computed,
            setLoading: action,
            setWorkspaceReady: action,
            setStartupProgress: action,
            setActiveTab: action,
            checkForSavedBots: action,
        });
    }

    get has_active_bot(): boolean {
        const workspace = window.Blockly?.derivWorkspace;

        if (!workspace) return false;

        return workspace.getTopBlocks().length > 0;
    }

    get has_saved_bots(): boolean {
        return this._has_saved_bots;
    }

    checkForSavedBots = async (): Promise<void> => {
        try {
            const workspaces = await getSavedWorkspaces();

            runInAction(() => {
                this._has_saved_bots =
                    Array.isArray(workspaces) && workspaces.length > 0;
            });
        } catch (error) {
            console.error('Error checking for saved workspaces:', error);

            runInAction(() => {
                this._has_saved_bots = false;
            });
        }
    };

    setActiveTab = (tab: string): void => {
        this.active_tab = tab;
        storeSetting('active_tab', tab);
    };

    setContainerSize = (): void => {
        if (this.active_tab === tabs_title.WORKSPACE) {
            onWorkspaceResize();
        }
    };

    onMount = (): void => {
        if (this.is_mounted) return;

        this.is_mounted = true;
        window.addEventListener('resize', this.setContainerSize);

        void this.checkForSavedBots();
    };

    getCachedActiveTab = (): void => {
        const savedTab = getSetting('active_tab');

        if (savedTab) {
            this.active_tab = savedTab;
        }
    };

    onUnmount = (): void => {
        if (!this.is_mounted) return;

        window.removeEventListener('resize', this.setContainerSize);
        this.is_mounted = false;
    };

    setLoading = (is_loading: boolean): void => {
        this.is_loading = is_loading;
    };

    setStartupProgress = (progress: number, message?: string): void => {
        this.startup_progress = Math.max(
            0,
            Math.min(99, Math.round(progress))
        );

        if (message) {
            this.startup_message = message;
        }
    };

    setWorkspaceReady = (is_ready: boolean): void => {
        this.is_workspace_ready = is_ready;

        if (is_ready) {
            this.startup_progress = 100;
            this.startup_message =
                'Workspace and saved strategy loaded successfully!';
            this.is_loading = false;
        }
    };
}
