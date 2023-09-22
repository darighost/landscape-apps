import _ from 'lodash';
import { unstable_batchedUpdates as batchUpdates } from 'react-dom';
import produce, { setAutoFreeze } from 'immer';
import { SetState } from 'zustand';
import { decToUd, udToDec, unixToDa } from '@urbit/api';
import { Poke } from '@urbit/http-api';
import bigInt, { BigInteger } from 'big-integer';
import { useCallback, useEffect, useMemo } from 'react';
import { Groups } from '@/types/groups';
import {
  DMBriefUpdate,
  ChatScan,
  Club,
  ClubAction,
  ClubDelta,
  Clubs,
  DmAction,
  DMBriefs,
  newWritMap,
  Pact,
  Pins,
  WritDelta,
  Writ,
} from '@/types/dms';
import {
  newQuipMap,
  Note,
  NoteEssay,
  Quip,
  ShelfAction,
} from '@/types/channel';
import api from '@/api';
import {
  whomIsDm,
  whomIsMultiDm,
  whomIsFlag,
  nestToFlag,
  whomIsNest,
} from '@/logic/utils';
import { useChatStore } from '@/chat/useChatStore';
import { getPreviewTracker } from '@/logic/subscriptionTracking';
import useReactQueryScry from '@/logic/useReactQueryScry';
import useReactQuerySubscription from '@/logic/useReactQuerySubscription';
import { getWindow } from '@/logic/windows';
import queryClient from '@/queryClient';
import { pokeOptimisticallyN, createState } from '../base';
import makeWritsStore, { writsReducer } from './writs';
import { BasedChatState, ChatState } from './type';
import clubReducer from './clubReducer';
import { useGroups } from '../groups';
import useSchedulerStore from '../scheduler';
import { channelAction, channelNoteAction, useBrief } from '../channel/channel';

setAutoFreeze(false);

function subscribeOnce<T>(app: string, path: string) {
  return new Promise<T>((resolve) => {
    api.subscribe({
      app,
      path,
      event: resolve,
    });
  });
}

function makeId() {
  const time = Date.now();
  return {
    id: `${window.our}/${decToUd(unixToDa(time).toString())}`,
    time,
  };
}

function dmAction(ship: string, delta: WritDelta, id: string): Poke<DmAction> {
  return {
    app: 'chat',
    mark: 'dm-action',
    json: {
      ship,
      diff: {
        id,
        delta,
      },
    },
  };
}

function multiDmAction(id: string, delta: ClubDelta): Poke<ClubAction> {
  return {
    app: 'chat',
    mark: 'club-action-0',
    json: {
      id,
      diff: {
        uid: '0v3',
        delta,
      },
    },
  };
}

async function optimisticAction(
  whom: string,
  id: string,
  delta: WritDelta,
  set: SetState<BasedChatState>
) {
  const action: Poke<DmAction | ClubAction> = whomIsDm(whom)
    ? dmAction(whom, delta as WritDelta, id)
    : multiDmAction(whom, { writ: { id, delta: delta as WritDelta } });

  set((draft) => {
    const potentialEvent =
      action.mark === 'club-action-0' &&
      'id' in action.json &&
      'writ' in action.json.diff.delta
        ? action.json.diff.delta.writ
        : (action.json as DmAction);
    const reduced = writsReducer(whom)(potentialEvent, draft);

    return {
      pacts: { ...reduced.pacts },
      writWindows: { ...reduced.writWindows },
    };
  });

  await api.poke<ClubAction | DmAction | ShelfAction>(action);
}

export const useChatState = createState<ChatState>(
  'chat',
  (set, get) => ({
    batchSet: (fn) => {
      batchUpdates(() => {
        set(produce(fn));
      });
    },
    dms: [],
    multiDms: {},
    dmArchive: [],
    pacts: {},
    pendingDms: [],
    pins: [],
    trackedMessages: [],
    writWindows: {},
    loadedRefs: {},
    loadedGraphRefs: {},
    togglePin: async (whom, pin) => {
      const { pins } = get();
      let newPins = [];

      if (pin) {
        newPins = [...pins, whom];
      } else {
        newPins = pins.filter((w) => w !== whom);
      }

      await api.poke<Pins>({
        app: 'chat',
        mark: 'chat-pins',
        json: {
          pins: newPins,
        },
      });

      get().fetchPins();
    },
    fetchPins: async () => {
      const { pins } = await api.scry<Pins>({
        app: 'chat',
        path: '/pins',
      });

      get().set((draft) => {
        draft.pins = pins;
      });
    },
    markDmRead: async (whom) => {
      if (whomIsNest(whom)) {
        await api.poke(channelAction(whom, { read: null }));
      } else {
        await api.poke({
          app: 'chat',
          mark: 'chat-remark-action',
          json: {
            whom,
            diff: { read: null },
          },
        });
      }
    },
    start: async ({ dms, clubs, briefs, pins, invited }) => {
      get().batchSet((draft) => {
        draft.pins = pins;
        draft.multiDms = clubs;
        draft.dms = dms;
        draft.pendingDms = invited;
        draft.pins = pins;
      });

      useChatStore.getState().update(briefs);

      api.subscribe(
        {
          app: 'chat',
          path: '/dm/invited',
          event: (event: unknown) => {
            get().batchSet((draft) => {
              draft.pendingDms = event as string[];
            });
          },
        },
        3
      );
      api.subscribe(
        {
          app: 'chat',
          path: '/clubs/ui',
          event: (event: ClubAction) => {
            get().batchSet(clubReducer(event));
          },
        },
        3
      );
    },
    fetchMessages: async (whom: string, count: string, dir, time) => {
      const isDM = whomIsDm(whom);
      const type = isDM ? 'dm' : 'club';

      const { getOlder, getNewer } = makeWritsStore(
        whom,
        get,
        set,
        `/${type}/${whom}/writs`,
        `/${type}/${whom}/ui${isDM ? '' : '/writs'}`
      );

      if (dir === 'older') {
        return getOlder(count, time);
      }

      return getNewer(count, time);
    },
    fetchMessagesAround: async (whom: string, count: string, time) => {
      const isDM = whomIsDm(whom);
      const type = isDM ? 'dm' : 'club';

      return makeWritsStore(
        whom,
        get,
        set,
        `/${type}/${whom}/writs`,
        `/${type}/${whom}/ui${isDM ? '' : '/writs'}`
      ).getAround(count, time);
    },
    fetchMultiDms: async () => {
      const dms = await api.scry<Clubs>({
        app: 'chat',
        path: '/clubs',
      });

      get().batchSet((draft) => {
        draft.multiDms = dms;
      });
    },
    fetchMultiDm: async (id, force) => {
      const { multiDms } = get();

      if (multiDms[id] && !force) {
        return multiDms[id];
      }

      const dm = await api.scry<Club>({
        app: 'chat',
        path: `/club/${id}/crew`,
      });

      if (!dm) {
        return {
          hive: [],
          team: [],
          meta: {
            title: '',
            description: '',
            image: '',
            cover: '',
          },
          pin: false,
        };
      }

      set((draft) => {
        draft.multiDms[id] = dm;
      });

      return dm;
    },
    fetchDms: async () => {
      const dms = await api.scry<string[]>({
        app: 'chat',
        path: '/dm',
      });

      get().batchSet((draft) => {
        draft.dms = dms;
      });
    },
    unarchiveDm: async (ship) => {
      await api.poke({
        app: 'chat',
        mark: 'dm-unarchive',
        json: ship,
      });
    },
    archiveDm: async (ship) => {
      await api.poke({
        app: 'chat',
        mark: 'dm-archive',
        json: ship,
      });
      queryClient.setQueryData(
        ['dm', 'briefs'],
        (briefs: DMBriefs | undefined) => {
          if (!briefs) {
            return briefs;
          }

          const newBriefs = { ...briefs };

          delete newBriefs[ship];

          return newBriefs;
        }
      );
      get().batchSet((draft) => {
        delete draft.pacts[ship];
        draft.dms = draft.dms.filter((s) => s !== ship);
      });
    },
    dmRsvp: async (ship, ok) => {
      get().batchSet((draft) => {
        draft.pendingDms = draft.pendingDms.filter((d) => d !== ship);
        if (!ok) {
          delete draft.pacts[ship];
          queryClient.setQueryData(
            ['dm', 'briefs'],
            (briefs: DMBriefs | undefined) => {
              if (!briefs) {
                return briefs;
              }

              if (!ok) {
                const newBriefs = { ...briefs };

                delete newBriefs[ship];

                return newBriefs;
              }

              return briefs;
            }
          );
          draft.dms = draft.dms.filter((s) => s !== ship);
        }
      });
      await api.poke({
        app: 'chat',
        mark: 'dm-rsvp',
        json: {
          ship,
          ok,
        },
      });
    },
    sendMessage: async (whom, mem) => {
      const isDM = whomIsDm(whom);
      // ensure time and ID match up
      const { id, time } = makeId();
      const memo: Omit<NoteEssay, 'han-data'> = {
        content: mem.content,
        author: mem.author,
        sent: time,
      };
      const diff = {
        add: {
          memo,
          kind: null,
          time: null,
        },
      };

      const { pacts } = get();
      const isNew = !(whom in pacts);
      get().batchSet((draft) => {
        if (isDM) {
          if (isNew) {
            draft.dms.push(whom);
            draft.pacts[whom] = { index: {}, writs: newWritMap() };

            return;
          }
        }

        draft.trackedMessages.push({ id, status: 'pending' });
      });

      await optimisticAction(whom, id, diff, set);
      set((draft) => {
        if (!isDM || !isNew) {
          draft.trackedMessages.map((msg) => {
            if (msg.id === id) {
              return { status: 'sent', id };
            }

            return msg;
          });
        }
      });
    },
    delDm: async (whom, id) => {
      const diff = { del: null };
      if (whomIsDm(whom)) {
        await api.trackedPoke<DmAction, DmAction>(
          dmAction(whom, diff, id),
          { app: 'chat', path: whom },
          (event) => event.ship === id && 'del' in event.diff
        );
      } else {
        await api.trackedPoke<ClubAction>(
          multiDmAction(whom, { writ: { id, delta: diff } }),
          { app: 'chat', path: whom }
        );
      }
    },
    addFeelToDm: async (whom, id, feel) => {
      const delta: WritDelta = {
        'add-feel': { feel, ship: window.our },
      };
      await optimisticAction(whom, id, delta, set);
    },
    delFeelToDm: async (whom, id) => {
      const delta: WritDelta = { 'del-feel': window.our };
      await optimisticAction(whom, id, delta, set);
    },
    initializeMultiDm: async (id) => {
      await makeWritsStore(
        id,
        get,
        set,
        `/club/${id}/writs`,
        `/club/${id}/ui/writs`
      ).initialize();
    },
    createMultiDm: async (id, hive) => {
      get().batchSet((draft) => {
        draft.multiDms[id] = {
          hive,
          team: [window.our],
          meta: {
            title: '',
            description: '',
            image: '',
            cover: '',
          },
        };
      });
      await api.poke({
        app: 'chat',
        mark: 'club-create',
        json: {
          id,
          hive,
        },
      });
    },
    editMultiDm: async (id, meta) =>
      api.trackedPoke<ClubAction>(
        multiDmAction(id, { meta }),
        {
          app: 'chat',
          path: `/clubs/ui`,
        },
        (event) =>
          'meta' in event.diff.delta &&
          meta.title === event.diff.delta.meta.title
      ),
    inviteToMultiDm: async (id, hive) => {
      await api.poke(multiDmAction(id, { hive: { ...hive, add: true } }));
    },
    removeFromMultiDm: async (id, hive) => {
      await api.poke(multiDmAction(id, { hive: { ...hive, add: false } }));
    },
    multiDmRsvp: async (id, ok) => {
      await api.poke(multiDmAction(id, { team: { ship: window.our, ok } }));
      await get().fetchMultiDm(id, true);
    },
    initialize: async (whom: string) => {
      await makeWritsStore(
        whom,
        get,
        set,
        `/chat/${whom}/writs`,
        `/chat/${whom}/ui/writs`
      ).initialize();
    },
    initializeDm: async (ship: string) => {
      await makeWritsStore(
        ship,
        get,
        set,
        `/dm/${ship}/writs`,
        `/dm/${ship}/ui`
      ).initialize();
    },
  }),
  {
    partialize: (state) => {
      const saved = _.pick(state, ['dms', 'pendingDms', 'multiDms', 'pins']);

      return saved;
    },
  },
  []
);

export function useWritWindow(whom: string, time?: string) {
  const window = useChatState(useCallback((s) => s.writWindows[whom], [whom]));

  return getWindow(window, time);
}

const emptyWrits = newWritMap();
export function useMessagesForChat(whom: string, near?: string) {
  const window = useWritWindow(whom, near);
  const writs = useChatState(useCallback((s) => s.pacts[whom]?.writs, [whom]));

  return useMemo(() => {
    return window && writs
      ? newWritMap(writs.getRange(window.oldest, window.newest, true))
      : writs || emptyWrits;
  }, [writs, window]);
}

export function useHasMessages(whom: string) {
  const messages = useMessagesForChat(whom);
  return messages.size > 0;
}

/**
 * @param replying: if set, we're replying to a message
 * @param whom (optional) if provided, overrides the default behavior of using the current channel flag
 * @returns bigInt.BigInteger[] of the ids of the messages for the flag / whom
 */
export function useChatKeys({ whom }: { replying: boolean; whom: string }) {
  const messages = useMessagesForChat(whom ?? '');
  return useMemo(() => Array.from(messages.keys()), [messages]);
}

export function useTrackedMessageStatus(id: string) {
  return useChatState(
    useCallback(
      (s) => s.trackedMessages.find((m) => m.id === id)?.status || 'delivered',
      [id]
    )
  );
}

const emptyBriefs: DMBriefs = {};
export function useDmBriefs() {
  const onEvent = (event: DMBriefUpdate) => {
    console.log({ event });

    queryClient.invalidateQueries(['dm', 'briefs']);
  };

  const { data, ...query } = useReactQuerySubscription<DMBriefs, DMBriefUpdate>(
    {
      queryKey: ['dm', 'briefs'],
      app: 'chat',
      path: '/briefs',
      scry: '/briefs',
      onEvent,
    }
  );

  if (!data) {
    return {
      ...query,
      data: emptyBriefs,
    };
  }

  return {
    ...query,
    data,
  };
}

export function useDmBrief(whom: string) {
  const briefs = useDmBriefs();
  return briefs.data[whom];
}

export function useChatLoading(whom: string) {
  const brief = useDmBrief(whom);

  return useChatState(
    useCallback((s) => !s.pacts[whom] && !!brief, [whom, brief])
  );
}

const emptyPact = { index: {}, writs: newWritMap() };
export function usePact(whom: string): Pact {
  return useChatState(useCallback((s) => s.pacts[whom] || emptyPact, [whom]));
}

const selPacts = (s: ChatState) => s.pacts;
export function usePacts() {
  return useChatState(selPacts);
}

export function useCurrentPactSize(whom: string) {
  return useChatState(
    useCallback((s) => s.pacts[whom]?.writs.size ?? 0, [whom])
  );
}

export function useWrit(
  whom: string,
  writId: string,
  ship: string,
  disabled = false
) {
  const queryKey = useMemo(() => ['dms', whom, writId], [whom, writId]);

  const path = useMemo(
    () => `/writ/id/${ship}/${decToUd(writId)}`,
    [ship, writId]
  );

  const enabled = useMemo(
    () => writId !== '0' && ship !== '' && !disabled,
    [writId, ship, disabled]
  );
  const { data, ...rest } = useReactQueryScry({
    queryKey,
    app: 'chat',
    path,
    options: {
      enabled,
    },
  });

  const writ = data as Writ;

  const quips = writ?.seal?.quips;

  if (
    quips === undefined ||
    quips === null ||
    Object.entries(quips).length === 0
  ) {
    return {
      writ: {
        ...writ,
        seal: {
          ...writ?.seal,
          quips: newQuipMap(),
          lastQuip: null,
        },
      },
      ...rest,
    };
  }

  const diff: [BigInteger, Quip][] = Object.entries(quips).map(([k, v]) => [
    bigInt(udToDec(k)),
    v as Quip,
  ]);

  const quipMap = newQuipMap(diff);

  const writWithQuips: Writ = {
    ...writ,
    seal: {
      ...writ?.seal,
      quips: quipMap,
    },
  };

  return {
    writ: writWithQuips,
    ...rest,
  };
}

export function useIsDmUnread(whom: string) {
  const { data: briefs } = useDmBriefs();
  const brief = briefs[whom];
  return Boolean(brief?.count > 0 && brief['read-id']);
}

const selPendingDms = (s: ChatState) => s.pendingDms;
export function usePendingDms() {
  return useChatState(selPendingDms);
}

export function useDmIsPending(ship: string) {
  return useChatState(useCallback((s) => s.pendingDms.includes(ship), [ship]));
}

const selMultiDms = (s: ChatState) => s.multiDms;
export function useMultiDms() {
  return useChatState(selMultiDms);
}

const selDms = (s: ChatState) => s.dms;
export function useDms() {
  return useChatState(selDms);
}

export function useMultiDm(id: string): Club | undefined {
  const multiDm = useChatState(useCallback((s) => s.multiDms[id], [id]));

  useEffect(() => {
    useChatState.getState().fetchMultiDm(id);
  }, [id]);

  return multiDm;
}

export function usePendingMultiDms() {
  const multiDms = useChatState(selMultiDms);

  return Object.entries(multiDms)
    .filter(([, value]) => value.hive.includes(window.our))
    .map(([key]) => key);
}

export function useMultiDmIsPending(id: string): boolean {
  const brief = useBrief(id);
  return useChatState(
    useCallback(
      (s) => {
        const chat = s.multiDms[id];
        const isPending = chat && chat.hive.includes(window.our);
        const inTeam = chat && chat.team.includes(window.our);

        if (isPending) {
          return true;
        }

        return !brief && !inTeam;
      },
      [id, brief]
    )
  );
}

const selDmArchive = (s: ChatState) => s.dmArchive;
export function useDmArchive() {
  return useChatState(selDmArchive);
}

export function isGroupBrief(brief: string) {
  return brief.includes('/');
}

// export function useBrief(whom: string) {
// return useChatState(useCallback((s: ChatState) => s.briefs[whom], [whom]));
// }

export function usePinned() {
  return useChatState(useCallback((s: ChatState) => s.pins, []));
}

export function usePinnedGroups() {
  const groups = useGroups();
  const pinned = usePinned();
  return useMemo(
    () =>
      pinned.filter(whomIsFlag).reduce(
        (memo, flag) =>
          groups && flag in groups
            ? {
                ...memo,
                [flag]: groups[flag],
              }
            : memo,
        {} as Groups
      ),
    [groups, pinned]
  );
}

export function usePinnedDms() {
  const pinned = usePinned();
  return useMemo(() => pinned.filter(whomIsDm), [pinned]);
}

export function usePinnedClubs() {
  const pinned = usePinned();
  return useMemo(() => pinned.filter(whomIsMultiDm), [pinned]);
}

type UnsubbedWrit = {
  flag: string;
  writ: Note;
};

const { shouldLoad, newAttempt, finished } = getPreviewTracker();

const selLoadedRefs = (s: ChatState) => s.loadedRefs;
export function useWritByFlagAndWritId(
  chFlag: string,
  idWrit: string,
  isScrolling: boolean
) {
  const refs = useChatState(selLoadedRefs);
  const path = `/said/${chFlag}/msg/${idWrit}`;
  const cached = refs[path];
  const pact = usePact(chFlag);
  const writIndex = pact && pact.index[idWrit];
  const writInPact = writIndex && pact && pact.writs.get(writIndex);

  useEffect(() => {
    if (!isScrolling && !writInPact && shouldLoad(path)) {
      newAttempt(path);
      subscribeOnce<UnsubbedWrit>('chat', path)
        .then(({ writ }) => {
          useChatState.getState().batchSet((draft) => {
            draft.loadedRefs[path] = writ;
          });
        })
        .finally(() => finished(path));
    }
  }, [path, isScrolling, writInPact]);

  if (writInPact) {
    return writInPact;
  }

  return cached;
}

export function useLatestMessage(chFlag: string): [BigInteger, Note | null] {
  const messages = useMessagesForChat(chFlag);
  const max = messages.maxKey();
  return messages.size > 0 && max
    ? [max, messages.get(max) || null]
    : [bigInt(), null];
}

export function useGetLatestChat() {
  const def = useMemo(() => newWritMap(), []);
  const pacts = usePacts();

  return (chFlag: string) => {
    const pactFlag = chFlag.startsWith('~') ? chFlag : nestToFlag(chFlag)[1];
    const messages = pacts[pactFlag]?.writs ?? def;
    const max = messages.maxKey();
    return messages.size > 0 && max
      ? [max, messages.get(max) || null]
      : [bigInt(), null];
  };
}

export function useGetFirstUnreadID(whom: string) {
  const keys = useChatKeys({ replying: false, whom });
  const brief = useDmBrief(whom);
  if (!brief) {
    return null;
  }
  const { 'read-id': lastRead } = brief;
  if (!lastRead) {
    return null;
  }
  // lastRead is formatted like: ~zod/123.456.789...
  const lastReadBN = bigInt(lastRead.split('/')[1].replaceAll('.', ''));
  const firstUnread = keys.find((key) => key.gt(lastReadBN));
  return firstUnread ?? null;
}

export function useChatSearch(whom: string, query: string) {
  const type = whomIsDm(whom) ? 'dm' : whomIsMultiDm(whom) ? 'club' : 'chat';
  const { data, ...rest } = useReactQueryScry<ChatScan>({
    queryKey: ['chat', 'search', whom, query],
    app: 'chat',
    path: `/${type}/${whom}/search/text/0/1.000/${query}`,
    options: {
      enabled: query !== '',
    },
  });

  const scan = useMemo(() => {
    return newWritMap(
      (data || []).map(({ time, writ }) => [bigInt(udToDec(time)), writ]),
      true
    );
  }, [data]);

  return {
    scan,
    ...rest,
  };
}

export function useIsDmOrMultiDm(whom: string) {
  return useMemo(() => whomIsDm(whom) || whomIsMultiDm(whom), [whom]);
}

(window as any).chat = useChatState.getState;
