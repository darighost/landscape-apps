import React, { useCallback, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import cn from 'classnames';
import EllipsisIcon from '../icons/EllipsisIcon';
import InviteIcon16 from '../icons/InviteIcon16';
import LinkIcon16 from '../icons/LinkIcon16';
import PinIcon16 from '../icons/PinIcon16';
import useCopyToClipboard from '../../logic/useCopyToClipboard';
import GroupInviteDialog from './GroupInviteDialog';

export default function GroupActions({ flag }: { flag: string }) {
  const [_copied, doCopy] = useCopyToClipboard();
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const onCloseInviteDialog = useCallback(
    (
      e:
        | React.MouseEvent<HTMLDivElement, MouseEvent>
        | React.MouseEvent<HTMLButtonElement, MouseEvent>
    ) => {
      e.stopPropagation();
      setShowInviteDialog(false);
    },
    []
  );

  const onInviteClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      e.stopPropagation();
      setShowInviteDialog(true);
    },
    []
  );

  const onCopyClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      e.stopPropagation();
      doCopy(flag);
    },
    [doCopy, flag]
  );

  const onPinClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      e.stopPropagation();
      // TODO
      // eslint-disable-next-line no-console
      console.log('pin');
    },
    []
  );

  return (
    <div className="justify-self-end">
      <div
        className={cn(
          'group-hover:opacity-100',
          isOpen ? 'opacity:100' : 'opacity-0'
        )}
      >
        <DropdownMenu.Root onOpenChange={(open) => setIsOpen(open)}>
          <DropdownMenu.Trigger
            className={'default-focus rounded-lg p-0.5 text-gray-600'}
            aria-label="Open Message Options"
          >
            <EllipsisIcon className="h-5 w-5" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="dropdown">
            <DropdownMenu.Item
              className={
                'dropdown-item flex items-center space-x-2 rounded-none text-blue'
              }
              onClick={onInviteClick}
            >
              <InviteIcon16 className="h-6 w-6" />
              Invite People
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={
                'dropdown-item flex items-center space-x-2 rounded-none text-blue'
              }
              onClick={onCopyClick}
            >
              <LinkIcon16 className="h-4 w-4" />
              Copy Group Link
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="dropdown-item flex items-center space-x-2 rounded-none"
              onClick={onPinClick}
            >
              <PinIcon16 className="mr-2 h-4 w-4" />
              Pin
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
      <GroupInviteDialog
        flag={flag}
        open={showInviteDialog}
        onClose={onCloseInviteDialog}
        onOpenChange={setShowInviteDialog}
      />
    </div>
  );
}
