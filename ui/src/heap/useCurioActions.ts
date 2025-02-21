import { useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { decToUd } from '@urbit/api';
import { Status } from '@/logic/status';
import { nestToFlag, citeToPath, useCopy } from '@/logic/utils';
import { useGroupFlag } from '@/state/groups';
import { useDeletePostMutation, usePostToggler } from '@/state/channel/channel';

interface useCurioActionsProps {
  nest: string;
  time: string;
  refToken?: string;
}

export default function useCurioActions({
  nest,
  time,
  refToken,
}: useCurioActionsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const flag = useGroupFlag();
  const [, chFlag] = nestToFlag(nest);
  const chanPath = citeToPath({
    chan: {
      nest,
      where: `/curio/${time}`,
    },
  });
  const { doCopy, didCopy } = useCopy(refToken ? refToken : chanPath);
  const { isHidden, show, hide } = usePostToggler(time);

  const [menuOpen, setMenuOpen] = useState(false);

  const delMutation = useDeletePostMutation();

  const onDelete = useCallback(async () => {
    setMenuOpen(false);
    delMutation.mutate(
      { nest, time: decToUd(time) },
      {
        onSuccess: () => {
          navigate(`/groups/${flag}/channels/heap/${chFlag}`);
        },
      }
    );
  }, [chFlag, time, delMutation, flag, navigate, nest]);

  const onEdit = useCallback(() => {
    setMenuOpen(false);
    navigate(`/groups/${flag}/channels/heap/${chFlag}/curio/${time}/edit`, {
      state: { backgroundLocation: location },
    });
  }, [location, navigate, time, flag, chFlag]);

  const navigateToCurio = useCallback(() => {
    navigate(`/groups/${refToken}`);
  }, [navigate, refToken]);

  const onCopy = useCallback(() => {
    doCopy();
    setTimeout(() => {
      setMenuOpen(false);
    }, 1000);
  }, [doCopy]);

  const toggleHidden = useCallback(() => {
    if (isHidden) {
      show();
    } else {
      hide();
    }
  }, [isHidden, show, hide]);

  return {
    didCopy,
    menuOpen,
    setMenuOpen,
    onDelete,
    isDeleteLoading: delMutation.isLoading,
    onEdit,
    onCopy,
    navigateToCurio,
    isHidden,
    toggleHidden,
  };
}
