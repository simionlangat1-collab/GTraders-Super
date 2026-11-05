
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import ChunkLoader from '@/components/loader/chunk-loader';

const BlocklyLoading = observer(() => {
    const { blockly_store } = useStore();
    const { is_loading, is_workspace_ready } = blockly_store;

    const [showCompletion, setShowCompletion] = useState(false);

    useEffect(() => {
        if (is_workspace_ready) {
            setShowCompletion(true);

            const timer = setTimeout(() => {
                setShowCompletion(false);
            }, 450);

            return () => clearTimeout(timer);
        }

        setShowCompletion(false);
    }, [is_workspace_ready]);

    if (!is_loading && !showCompletion) {
        return null;
    }

    const progress = is_workspace_ready ? 100 : 75;

    const message = is_workspace_ready
        ? 'Saved strategy loaded. GTraders Super is ready!'
        : 'Initializing Blockly workspace and loading saved strategy...';

    return (
        <ChunkLoader
            progress={progress}
            message={message}
            isConnected={true}
        />
    );
});

export default BlocklyLoading;
