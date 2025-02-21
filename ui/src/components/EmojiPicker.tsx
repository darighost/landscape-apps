import React, { useCallback, useEffect } from 'react';
import Picker from '@emoji-mart/react';
import * as Popover from '@radix-ui/react-popover';
import { useParams } from 'react-router';
import useEmoji from '@/state/emoji';
import { useDismissNavigate } from '@/logic/routing';
import { useIsMobile } from '@/logic/useMedia';
import {
  useAddDMReplyReactMutation,
  useAddDmReactMutation,
} from '@/state/chat';
import { useCurrentTheme } from '@/state/local';
import { useRouteGroup } from '@/state/groups';
import useGroupPrivacy from '@/logic/useGroupPrivacy';
import { captureGroupsAnalyticsEvent } from '@/logic/analytics';
import {
  useAddPostReactMutation,
  useAddReplyReactMutation,
} from '@/state/channel/channel';
import {
  useIsDmOrMultiDm,
  useIsInThread,
  useThreadParentId,
} from '@/logic/utils';
import LoadingSpinner from './LoadingSpinner/LoadingSpinner';

interface EmojiPickerProps extends Record<string, any> {
  open?: boolean;
  setOpen?: (open: boolean) => void;
  children?: React.ReactChild;
  withTrigger?: boolean;
}

export default function EmojiPicker({
  open,
  setOpen,
  children,
  withTrigger = true,
  ...props
}: EmojiPickerProps) {
  const { data, load } = useEmoji();
  const { ship, chName, chShip, writShip, writTime } = useParams<{
    ship: string;
    chName: string;
    chShip: string;
    writShip?: string;
    writTime: string;
  }>();
  const currentTheme = useCurrentTheme();
  const whom = chShip ? `${chShip}/${chName}` : ship;
  const nest = `chat/${whom}`;
  const groupFlag = useRouteGroup();
  const { privacy } = useGroupPrivacy(groupFlag);
  const writId = writShip ? `${writShip}/${writTime}` : `${writTime}`;
  const isMobile = useIsMobile();
  const isDMOrMultiDM = useIsDmOrMultiDm(whom!);
  const inThread = useIsInThread();
  const threadParentId = useThreadParentId(whom!);
  const { mutate: addFeelToChat } = useAddPostReactMutation();
  const { mutate: addFeelToReply } = useAddReplyReactMutation();
  const { mutate: addFeelToDmReply } = useAddDMReplyReactMutation();
  const { mutate: addFeelToDm } = useAddDmReactMutation();
  const width = window.innerWidth;
  const dismss = useDismissNavigate();
  const mobilePerLineCount = Math.floor((width - 10) / 36);

  useEffect(() => {
    load();
  }, [load]);

  const mobileOnOpenChange = (o: boolean) => {
    if (o) {
      dismss();
    }
  };

  const onEmojiSelect = useCallback(
    async (emoji: { shortcodes: string }) => {
      if (isDMOrMultiDM && !inThread) {
        addFeelToDm({ whom: whom!, id: writId, react: emoji.shortcodes });
      } else if (isDMOrMultiDM && inThread) {
        addFeelToDmReply({
          whom: whom!,
          writId: threadParentId!,
          replyId: writId,
          react: emoji.shortcodes,
        });
      } else if (inThread) {
        addFeelToReply({
          nest,
          postId: threadParentId!,
          replyId: writId,
          react: emoji.shortcodes,
        });
      } else {
        addFeelToChat({ nest, postId: writId, react: emoji.shortcodes });
      }

      captureGroupsAnalyticsEvent({
        name: 'react_item',
        groupFlag,
        chFlag: whom,
        channelType: 'chat',
        privacy,
      });
      dismss();
    },
    [
      whom,
      groupFlag,
      privacy,
      writId,
      dismss,
      nest,
      isDMOrMultiDM,
      addFeelToChat,
      addFeelToDm,
      addFeelToReply,
      addFeelToDmReply,
      inThread,
      threadParentId,
    ]
  );

  return (
    <Popover.Root
      defaultOpen={isMobile}
      open={isMobile ? undefined : open}
      onOpenChange={isMobile ? mobileOnOpenChange : setOpen}
    >
      {withTrigger && !isMobile ? (
        <Popover.Trigger asChild>{children}</Popover.Trigger>
      ) : !isMobile ? (
        children
      ) : null}
      {(isMobile || !withTrigger) && (
        <Popover.Anchor className={isMobile ? 'fixed inset-x-0 top-10' : ''} />
      )}
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={30}
          collisionPadding={15}
          onInteractOutside={isMobile ? () => dismss() : undefined}
          data-testid="emoji-picker"
        >
          <div className="z-50 mx-10 flex h-96 w-72 items-center justify-center">
            {data ? (
              <Picker
                data={data}
                autoFocus={isMobile}
                perLine={isMobile ? mobilePerLineCount : 9}
                previewPosition="none"
                theme={currentTheme}
                onEmojiSelect={isMobile ? onEmojiSelect : undefined}
                {...props}
              />
            ) : (
              <div className="flex h-96 w-72 items-center justify-center">
                <LoadingSpinner className="h-6 w-6" />
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
