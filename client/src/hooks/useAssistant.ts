import { useEffect, useState, useSyncExternalStore } from 'react';
import { AssistantController } from '../lib/assistant';

/** One controller for the app's lifetime; React only subscribes to its state. */
export function useAssistant() {
  const [controller] = useState(() => new AssistantController());
  const state = useSyncExternalStore(controller.subscribe, controller.getState);

  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  return { state, controller };
}
