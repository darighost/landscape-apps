import cn from 'classnames';
import React, {
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Link } from 'react-router-dom';
import Dialog from '@/components/Dialog';
import EllipsisIcon from '@/components/icons/EllipsisIcon';
import {
  useChatState,
  useIsDmUnread,
  usePinned,
} from '@/state/chat';
import BulletIcon from '@/components/icons/BulletIcon';
import { useIsMobile } from '@/logic/useMedia';
import { whomIsDm } from '@/logic/utils';
import ActionMenu, { Action } from '@/components/ActionMenu';
import DmInviteDialog from './DmInviteDialog';

type DMOptionsProps = PropsWithChildren<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  whom: string;
  pending: boolean;
  isHovered?: boolean;
  className?: string;
  isMulti?: boolean;
  alwaysShowEllipsis?: boolean;
  triggerDisabled?: boolean;
}>;

export default function DmOptions({
  open = false,
  onOpenChange,
  whom,
  pending,
  isHovered = true,
  isMulti = false,
  alwaysShowEllipsis = false,
  triggerDisabled,
  className,
  children,
}: DMOptionsProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pinned = usePinned();
  const isUnread = useIsDmUnread(whom);
  const hasActivity = isUnread || pending;

  const [isOpen, setIsOpen] = useState(open);
  const handleOpenChange = (innerOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(innerOpen);
    } else {
      setIsOpen(innerOpen);
    }
  };

  useEffect(() => {
    setIsOpen(open);
  }, [open]);

  const [inviteIsOpen, setInviteIsOpen] = useState(false);
  const onArchive = () => {
    navigate('/');
    useChatState.getState().archiveDm(whom);
  };

  const markRead = useCallback(
    async () => useChatState.getState().markDmRead(whom),
    [whom]
  );

  const [dialog, setDialog] = useState(false);

  const leaveMessage = async () => {
    navigate('/');
    if (whomIsDm(whom)) {
      await useChatState.getState().dmRsvp(whom, false);
    } else {
      await useChatState.getState().multiDmRsvp(whom, false);
    }
  };
  const closeDialog = () => {
    setDialog(false);
  };

  const handlePin = useCallback(
    async (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      e.stopPropagation();
      const isPinned = pinned.includes(whom);
      await useChatState.getState().togglePin(whom, !isPinned);
    },
    [whom, pinned]
  );

  const handleInvite = () => {
    setInviteIsOpen(true);
  };

  const handleAccept = () => {
    useChatState.getState().dmRsvp(whom, true);
  };
  const handleDecline = async () => {
    navigate(-1);
    await useChatState.getState().dmRsvp(whom, false);
  };

  const handleMultiAccept = async () => {
    await useChatState.getState().multiDmRsvp(whom, true);
  };

  const handleMultiDecline = async () => {
    await useChatState.getState().multiDmRsvp(whom, false);
  };

  if (!isHovered && !alwaysShowEllipsis && !isOpen) {
    return hasActivity ? (
      <button className={cn('relative h-6 w-6 appearance-none', className)}>
        <BulletIcon
          className="h-6 w-6 text-blue transition-opacity group-focus-within:opacity-0 group-hover:opacity-0"
          aria-label="Has Activity"
        />
      </button>
    ) : null;
  }

  const actions: Action[] = [];

  if (pending) {
    actions.push(
      {
        key: 'accept',
        onClick: isMulti ? handleMultiAccept : handleAccept,
        content: 'Accept',
      },
      {
        key: 'decline',
        onClick: isMulti ? handleMultiDecline : handleDecline,
        content: 'Decline',
      }
    );
  } else {
    if (hasActivity) {
      actions.push({
        key: 'mark',
        type: 'prominent',
        onClick: markRead,
        content: 'Mark Read',
      });
    }

    if (isMulti) {
      actions.push({
        key: 'info',
        content: (
          <Link
            to={`/dm/${whom}/edit-info`}
            state={{ backgroundLocation: location }}
          >
            Chat Info
          </Link>
        ),
      });
    }

    actions.push({
      key: 'pin',
      onClick: handlePin,
      content: pinned.includes(whom) ? 'Unpin' : 'Pin',
    });

    if (isMulti) {
      actions.push({
        key: 'invite',
        onClick: handleInvite,
        content: 'Invite',
      });
    }

    actions.push({
      key: 'leave',
      type: 'destructive',
      onClick: leaveMessage,
      content: 'Leave Message',
    });
  }

  return (
    <>
      <ActionMenu
        open={isOpen}
        onOpenChange={handleOpenChange}
        actions={actions}
        disabled={triggerDisabled}
        asChild={!triggerDisabled}
        className={className}
      >
        {!alwaysShowEllipsis && children ? (
          children
        ) : (
          <div className={cn('relative h-6 w-6 text-gray-600', className)}>
            {!alwaysShowEllipsis && (isMobile || !isOpen) && hasActivity ? (
              <BulletIcon
                className="absolute h-6 w-6 text-blue transition-opacity group-focus-within:opacity-0 group-hover:opacity-0"
                aria-label="Has Activity"
              />
            ) : null}
            {!isMobile && (
              <button
                className={cn(
                  'default-focus absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-0.5 transition-opacity focus-within:opacity-100 hover:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100',
                  hasActivity && 'text-blue',
                  isOpen || alwaysShowEllipsis ? 'opacity:100' : 'opacity-0'
                )}
                aria-label="Open Message Options"
              >
                <EllipsisIcon className="h-6 w-6 text-inherit" />
              </button>
            )}
          </div>
        )}
      </ActionMenu>
      <Dialog open={dialog} onOpenChange={setDialog} containerClass="max-w-md">
        <div className="flex flex-col">
          <h2 className="mb-4 text-lg font-bold">Leave Chat</h2>
          <p className="mb-7 leading-5">
            Are you sure you want to leave this chat? Leaving will move this
            chat into your <strong>Archive</strong>. If you rejoin this channel,
            you’ll download everything you’ve missed since leaving it.
          </p>
          <div className="flex items-center justify-end space-x-2">
            <button onClick={closeDialog} className="button" type="button">
              Cancel
            </button>

            <button
              onClick={onArchive}
              className="button bg-red text-white"
              type="button"
            >
              Leave Chat
            </button>
          </div>
        </div>
      </Dialog>
      {isMulti ? (
        <DmInviteDialog
          inviteIsOpen={inviteIsOpen}
          setInviteIsOpen={setInviteIsOpen}
          whom={whom}
        />
      ) : null}
    </>
  );
}
