
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useApiBase } from '@/hooks/useApiBase';
import {
    CONNECTION_STATUS,
} from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import ChunkLoader from '@/components/loader/chunk-loader';

const BlocklyLoading = observer(() => {
    const { blockly_store } = useStore();
    const { is_loading, is_workspace_ready } = blockly_store;
    const { connectionStatus } = useApiBase();

    const [completionDismissed, setCompletionDismissed] = useState(false);

    useEffect(() => {
        if (!is_workspace_ready) {
            setCompletionDismissed(false);
            return;
        }

        const timer = setTimeout(() => {
            setCompletionDismissed(true);
        }, 450);

        return () => clearTimeout(timer);
    }, [is_workspace_ready]);

    if (!is_loading && (!is_workspace_ready || completionDismissed)) {
        return null;
    }

    const isConnected =
        connectionStatus === CONNECTION_STATUS.OPENED;

    const progress = is_workspace_ready ? 100 : 75;

    const message = is_workspace_ready
        ? 'Saved strategy loaded. GTraders Super is ready!'
        : 'Initializing Blockly workspace and loading saved strategy...';

    return (
        <ChunkLoader
            progress={progress}
            message={message}
            isConnected={isConnected}
        />
    );
});

export default BlocklyLoading;
