import cn from 'classnames';
import { useLocation } from 'react-router';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StateSnapshot, Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useIsMobile } from '@/logic/useMedia';
import {
  useGroup,
  useGroupConnection,
  useGroupFlag,
  useVessel,
} from '@/state/groups';
import SortIcon from '@/components/icons/SortIcon';
import SidebarItem from '@/components/Sidebar/SidebarItem';
import { GroupChannel } from '@/types/groups';
import Divider from '@/components/Divider';
import ChannelIcon from '@/channels/ChannelIcon';
import {
  useChannelSections,
  useChannelSort,
  useCheckChannelJoined,
  useCheckChannelUnread,
  channelHref,
  canReadChannel,
} from '@/logic/channel';
import UnreadIndicator from '@/components/Sidebar/UnreadIndicator';
import HashIcon from '@/components/icons/HashIcon';
import useFilteredSections from '@/logic/useFilteredSections';
import GroupListPlaceholder from '@/components/Sidebar/GroupListPlaceholder';
import LoadingSpinner from '@/components/LoadingSpinner/LoadingSpinner';
import ActionMenu, { Action } from '@/components/ActionMenu';
import FilterIconMobileNav from '@/components/icons/FilterIconMobileNav';
import CaretRightIcon from '@/components/icons/CaretRightIcon';
import ElipsisIcon from '@/components/icons/EllipsisIcon';
import SmileIcon from '@/components/icons/SmileIcon';
import PlaneIcon from '@/components/icons/PlaneIcon';
import { DEFAULT_SORT } from '@/constants';

const UNZONED = 'default';

type ChannelSorterProps = {
  isMobile?: boolean;
};

export function ChannelSorter({ isMobile }: ChannelSorterProps) {
  const { sortFn, sortOptions, setSortFn } = useChannelSort();
  const [open, setOpen] = useState(false);

  function sortLabel() {
    switch (sortFn) {
      case 'Arranged':
        return 'Arranged Channels';
      case 'Recent':
        return 'Recent Activity';
      case 'A → Z':
        return 'Channels A → Z';
      default:
        return 'Channels';
    }
  }

  const actions: Action[] = [];

  if (!isMobile) {
    actions.push({
      key: 'ordering',
      type: 'disabled',
      content: 'Channel Ordering',
    });
  }

  Object.keys(sortOptions).forEach((k) => {
    actions.push({
      key: k,
      type: k === sortFn ? 'prominent' : 'default',
      onClick: () => setSortFn(k),
      content: k,
    });
  });

  return (
    <div className="border-gray-50 sm:flex sm:w-full sm:items-center sm:justify-between sm:border-t-2 sm:p-2 sm:py-3">
      {!isMobile && (
        <h2 className="px-2 pb-0 text-sm font-semibold text-gray-400">
          {sortLabel()}
        </h2>
      )}
      <ActionMenu
        open={open}
        onOpenChange={setOpen}
        actions={actions}
        asChild={false}
        triggerClassName={cn(
          'default-focus flex items-center rounded-lg text-base font-semibold  sm:p-1',
          isMobile ? 'bg-none' : 'dark:mix-blend-screen hover:bg-gray-50'
        )}
        contentClassName="w-56"
        ariaLabel="Groups Sort Options"
      >
        {isMobile ? (
          <FilterIconMobileNav className="h-8 w-8" />
        ) : (
          <SortIcon className="h-6 w-6 text-gray-400 sm:h-4 sm:w-4" />
        )}
      </ActionMenu>
    </div>
  );
}

type ListItem =
  | {
      type: 'static-top';
    }
  | {
      type: 'section-header';
      section: string;
    }
  | {
      type: 'channel';
      channel: [string, GroupChannel];
    };

const virtuosoStateByFlag: Record<string, StateSnapshot> = {};

const ChannelList = React.memo(({ paddingTop }: { paddingTop?: number }) => {
  const flag = useGroupFlag();
  const group = useGroup(flag);
  const connected = useGroupConnection(flag);
  const { sortFn, sortChannels } = useChannelSort();
  const isDefaultSort = sortFn === DEFAULT_SORT;
  const { sectionedChannels } = useChannelSections(flag);
  const filteredSections = useFilteredSections(flag, true);
  const isMobile = useIsMobile();
  const vessel = useVessel(flag, window.our);
  const isChannelJoined = useCheckChannelJoined();
  const isChannelUnread = useCheckChannelUnread();
  const location = useLocation();

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    const currentVirtuosoRef = virtuosoRef.current;
    return () => {
      currentVirtuosoRef?.getState((state) => {
        virtuosoStateByFlag[flag] = state;
      });
    };
  }, [flag]);

  const items: ListItem[] = useMemo(() => {
    if (!group) {
      return [];
    }

    const arr: ListItem[] = [{ type: 'static-top' }];

    const shouldShowChannel = ([nest, channel]: [string, GroupChannel]) =>
      isChannelJoined(nest) && canReadChannel(channel, vessel, group.bloc);

    if (isDefaultSort) {
      filteredSections.forEach((s) => {
        if (s !== UNZONED) {
          const title = s in group.zones ? group.zones[s].meta.title : '';
          arr.push({
            type: 'section-header',
            section: title,
          });
        }

        sectionedChannels[s].forEach((channel) => {
          if (shouldShowChannel(channel)) {
            arr.push({ type: 'channel', channel });
          }
        });
      });
    } else {
      sortChannels(group.channels).forEach((channel) => {
        if (shouldShowChannel(channel)) {
          arr.push({ type: 'channel', channel });
        }
      });
    }

    return arr;
  }, [
    group,
    isDefaultSort,
    isChannelJoined,
    vessel,
    filteredSections,
    sectionedChannels,
    sortChannels,
  ]);

  const renderStaticTop = useCallback(() => {
    if (!isMobile) {
      return <ChannelSorter isMobile={false} />;
    }

    return (
      <div className={cn('mx-4 sm:mx-2', paddingTop && `pt-${paddingTop}`)}>
        <SidebarItem
          icon={
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
              <HashIcon className="m-1 h-6 w-6 text-gray-800" />
            </div>
          }
          to={`/groups/${flag}/channels`}
          actions={<CaretRightIcon className="h-6 w-6 text-gray-800" />}
        >
          Channels
        </SidebarItem>
        <SidebarItem
          icon={
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
              <SmileIcon className="m-1 h-6 w-6 text-gray-800" />
            </div>
          }
          to="./members"
          actions={<CaretRightIcon className="h-6 w-6 text-gray-800" />}
        >
          Members
        </SidebarItem>
        <SidebarItem
          color="text-blue"
          highlight="bg-blue-soft"
          icon={
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-soft">
              <PlaneIcon className="h-6 w-6" />
            </div>
          }
          to={`/groups/${flag}/invite`}
          state={{ backgroundLocation: location }}
          actions={<ElipsisIcon className="h-6 w-6 text-blue" />}
        >
          Invite People
        </SidebarItem>
      </div>
    );
  }, [isMobile, flag, location, paddingTop]);

  const renderSectionHeader = useCallback(
    (section: string) => <Divider isMobile={isMobile}>{section}</Divider>,
    [isMobile]
  );

  const renderChannel = useCallback(
    ([nest, channel]: [string, GroupChannel]) => {
      const icon = (active: boolean) =>
        isMobile ? (
          <span
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-md',
              active && 'bg-white'
            )}
          >
            <ChannelIcon nest={nest} className="h-6 w-6 text-gray-800" />
          </span>
        ) : (
          <ChannelIcon nest={nest} className="h-6 w-6" />
        );

      return (
        <SidebarItem
          inexact
          key={nest}
          icon={icon}
          to={channelHref(flag, nest)}
          actions={
            isChannelUnread(nest) ? (
              <UnreadIndicator className="m-0.5 h-5 w-5 text-blue" />
            ) : null
          }
        >
          {channel.meta.title || nest}
        </SidebarItem>
      );
    },
    [flag, isChannelUnread, isMobile]
  );

  const renderItem = useCallback(
    (_index: number, item: ListItem) => {
      switch (item.type) {
        case 'static-top':
          return renderStaticTop();
        case 'section-header':
          return (
            <div className="mx-4 text-gray-100 sm:mx-2">
              {renderSectionHeader(item.section)}
            </div>
          );
        case 'channel':
          return (
            <div className="mx-4 sm:mx-2">{renderChannel(item.channel)}</div>
          );
        default:
          return null;
      }
    },
    [renderStaticTop, renderSectionHeader, renderChannel]
  );

  const computeItemKey = useCallback((_index: number, item: ListItem) => {
    switch (item.type) {
      case 'static-top':
        return 'static-top';
      case 'section-header':
        return item.section;
      case 'channel':
        return item.channel[0];
      default:
        return '';
    }
  }, []);

  if (!group || group.meta.title === '') {
    return (
      <div className={cn('h-full w-full flex-1 overflow-y-auto')}>
        <h2 className="px-4 pb-0 text-sm font-semibold text-gray-400">
          <div className="flex justify-between">
            {!connected ? (
              'Host is Offline.'
            ) : (
              <>
                Loading Channels
                <LoadingSpinner className="h-4 w-4 text-gray-400" />
              </>
            )}
          </div>
        </h2>
        <GroupListPlaceholder count={15} pulse={connected} />;
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={items}
      computeItemKey={computeItemKey}
      itemContent={renderItem}
      restoreStateFrom={virtuosoStateByFlag[flag]}
      className="h-full w-full flex-1 space-y-0.5 overflow-x-hidden"
    />
  );
});

export default ChannelList;
