import { difference } from 'lodash';
import ob from 'urbit-ob';
import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useLocalStorage } from 'usehooks-ts';
import { ShipOption } from '@/components/ShipSelector';
import { useChatState, useMultiDms } from '@/state/chat';
import createClub from '@/state/chat/createClub';
import { ChatMemo } from '@/types/chat';
import { createStorageKey, newUv, preSig } from './utils';

export default function useMessageSelector() {
  const navigate = useNavigate();
  const newClubId = useMemo(() => newUv(), []);
  const [ships, setShips] = useLocalStorage<ShipOption[]>(
    createStorageKey('new-dm-ships'),
    []
  );
  const isMultiDm = ships.length > 1;
  const shipValues = useMemo(() => ships.map((o) => preSig(o.value)), [ships]);
  const multiDms = useMultiDms();

  const existingDM = useMemo(() => {
    if (ships.length !== 1) {
      return null;
    }

    const { briefs: chatBriefs } = useChatState.getState();
    return (
      Object.entries(chatBriefs).find(([flag, _brief]) => {
        const theShip = preSig(ships[0].value);
        const sameDM = theShip === flag;
        return sameDM;
      })?.[0] ?? null
    );
  }, [ships]);

  const existingMultiDm = useMemo(() => {
    const { briefs } = useChatState.getState();
    return Object.entries(multiDms).reduce<string>((key, [k, v]) => {
      const theShips = [...v.hive, ...v.team];
      const sameDM =
        difference(shipValues, theShips).length === 0 &&
        shipValues.length === theShips.length;
      const brief = briefs[key];
      const newBrief = briefs[k];
      const newer = !brief || (brief && newBrief && newBrief.last > brief.last);
      if (sameDM && newer) {
        return k;
      }

      return key;
    }, '');
  }, [multiDms, shipValues]);

  const onEnter = useCallback(
    async (invites: ShipOption[]) => {
      if (existingMultiDm) {
        navigate(`/dm/${existingMultiDm}`);
      } else if (existingDM) {
        navigate(`/dm/${preSig(existingDM)}`);
      } else if (isMultiDm) {
        await createClub(
          newClubId,
          invites.map((s) => s.value)
        );
        navigate(`/dm/${newClubId}`);
      } else {
        navigate(`/dm/${preSig(invites[0].value)}`);
      }

      setShips([]);
    },
    [existingMultiDm, existingDM, isMultiDm, setShips, navigate, newClubId]
  );

  const sendDm = useCallback(
    async (whom: string, memo: ChatMemo) => {
      if (isMultiDm && shipValues && whom !== existingMultiDm) {
        await createClub(whom, shipValues);
      }

      await useChatState.getState().sendMessage(whom, memo);
      setShips([]);
      navigate(`/dm/${isMultiDm ? whom : preSig(whom)}`);
    },
    [isMultiDm, shipValues, existingMultiDm, setShips, navigate]
  );

  const whom = useMemo(
    () =>
      ships.length > 0
        ? isMultiDm
          ? existingMultiDm || newClubId
          : ships[0].value
        : '',
    [existingMultiDm, isMultiDm, newClubId, ships]
  );

  const validShips = useCallback(
    () =>
      Boolean(shipValues.length) &&
      shipValues.every((ship) => ob.isValidPatp(ship)),
    [shipValues]
  );

  return {
    onEnter,
    sendDm,
    setShips,
    ships,
    validShips,
    whom,
  };
}
