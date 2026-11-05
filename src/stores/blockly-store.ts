
import { action, computed, makeObservable, observable } from 'mobx';
import { tabs_title } from '@/constants/bot-contents';
import { getSavedWorkspaces, onWorkspaceResize } from '@/external/bot-skeleton';
import { getSetting, storeSetting } from '@/utils/settings';
import RootStore from './root-store';

export default class BlocklyStore {
    root_store: RootStore;

    constructor(root_store: RootStore) {
        makeObservable(this, {
            is_loading: observable,
            is_workspace_ready: observable,
            active_tab: observable,
            _has_saved_bots: observable,
            has_active_bot: computed,
            has_saved_bots: computed,
            setLoading: action,
            setWorkspaceReady: action,
            setActiveTab: action,
            checkForSavedBots: action,
        });
        this.root_store = root_store;
    }

    is_loading = false;
    is_workspace_ready = false;
    active_tab = tabs_title.WORKSPACE;

    get has_active_bot(): boolean {
        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace) return false;

        const top_blocks = workspace.getTopBlocks();
        return top_blocks && top_blocks.length > 0;
    }

    get has_saved_bots(): boolean {
        return this._has_saved_bots;
    }

    _has_saved_bots = false;

    checkForSavedBots = async (): Promise<void> => {
        try {
            const workspaces = await getSavedWorkspaces();
            this._has_saved_bots =
                Array.isArray(workspaces) && workspaces.length > 0;
        } catch (e) {
            console.error('Error checking for saved workspaces:', e);
            this._has_saved_bots = false;
        }
    };

    setActiveTab = (tab: string): void => {
        this.active_tab = tab;
        storeSetting('active_tab', this.active_tab);
    };

    setContainerSize = (): void => {
        if (this.active_tab === tabs_title.WORKSPACE) {
            onWorkspaceResize();
        }
    };

    onMount = (): void => {
        window.addEventListener('resize', this.setContainerSize);
        this.checkForSavedBots();
    };

    getCachedActiveTab = (): void => {
        if (getSetting('active_tab')) {
            this.active_tab = getSetting('active_tab');
        }
    };

    onUnmount = (): void => {
        window.removeEventListener('resize', this.setContainerSize);
    };

    setLoading = (is_loading: boolean): void => {
        this.is_loading = is_loading;
    };

    setWorkspaceReady = (is_ready: boolean): void => {
        this.is_workspace_ready = is_ready;
    };
}
