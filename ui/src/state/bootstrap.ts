import api from '@/api';
import { isTalk } from '@/logic/utils';
import { Init } from '@/types/ui';
import { useChatState } from './chat';
import useContactState from './contact';
import { useDiaryState } from './diary';
import useDocketState from './docket';
import { useGroupState } from './groups';
import useHarkState from './hark';
import { useHeapState } from './heap/heap';
import useKilnState from './kiln';
import usePalsState from './pals';
import useSchedulerStore from './scheduler';
import { useSettingsState } from './settings';
import { useStorage } from './storage';

export default async function bootstrap(reset = false) {
  const { wait } = useSchedulerStore.getState();
  if (reset) {
    api.reset();
    useChatState.getState().clearSubs();
    useHeapState.getState().clearSubs();
    useDiaryState.getState().clearSubs();
  }

  const { chat, heap, diary, ...groups } = await api.scry<Init>({
    app: 'groups-ui',
    path: '/init',
  });

  useGroupState.getState().start(groups);
  useChatState.getState().start(chat);

  if (isTalk) {
    useChatState.getState().fetchDms();
    useChatState.getState().fetchMultiDms();
  } else {
    useHeapState.getState().start(heap);
    useDiaryState.getState().start(diary);
  }

  const { initialize: settingsInitialize, fetchAll } =
    useSettingsState.getState();

  wait(() => {
    useHarkState.getState().start();
    useContactState.getState().initialize(api);
    useStorage.getState().initialize(api);

    fetchAll();
  }, 3);

  wait(() => {
    settingsInitialize(api);
    useKilnState.getState().initializeKiln();
    const { start, fetchCharges } = useDocketState.getState();
    fetchCharges();
    start();

    usePalsState.getState().initializePals();
  }, 5);
}
