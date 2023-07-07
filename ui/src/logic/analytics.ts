import posthog, { Properties } from 'posthog-js';
import { PrivacyType } from '@/types/groups';
import { log } from './utils';

export type AnalyticsEventName =
  | 'app_open'
  | 'app_close'
  | 'profile_edit'
  | 'profile_view'
  | 'open_group'
  | 'leave_group'
  | 'open_channel'
  | 'leave_channel'
  | 'react_item'
  | 'comment_item'
  | 'post_item'
  | 'view_item';

export type AnalyticsChannelType = 'chat' | 'diary' | 'heap';

export type GroupsAnalyticsEvent = {
  name: AnalyticsEventName;
  leaveName?: AnalyticsEventName;
  groupFlag: string;
  chFlag?: string;
  channelType?: AnalyticsChannelType;
  privacy?: PrivacyType;
};

// Configure PostHog with all auto-capturing settings disabled,
// as we will only be tracking specific interactions.
posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
  api_host: 'https://eu.posthog.com',
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  disable_session_recording: true,
  mask_all_text: true,
  mask_all_element_attributes: true,
  // this stops all capturing from happening until we manually opt-in.
  // this is to prevent accidentally capturing data. all opting is managed
  // in the activity checker in ActivityModal.
  opt_out_capturing_by_default: true,
});

if (import.meta.env.DEV) {
  posthog.debug();
}

export const analyticsClient = posthog;

export const captureAnalyticsEvent = (
  name: AnalyticsEventName,
  properties?: Properties
) => {
  log('Attempting to capture analytics event', name);
  const captureProperties: Properties = {
    // The following default properties stop PostHog from auto-logging the URL,
    // which can inadvertently reveal private info on Urbit
    $current_url: null,
    $pathname: null,
    $set_once: null,
    ...(properties || {}),
  };

  posthog.capture(name, captureProperties);
};

export const captureGroupsAnalyticsEvent = ({
  name,
  groupFlag,
  chFlag,
  channelType,
  privacy,
}: GroupsAnalyticsEvent) => {
  if (!privacy || privacy === 'secret') {
    return;
  }

  const properties: Properties = {};

  if (channelType) {
    properties.channel_type = channelType;
  }

  if (privacy === 'public') {
    properties.group_flag = groupFlag;
    if (chFlag) {
      properties.channel_flag = chFlag;
    }
  }

  captureAnalyticsEvent(name, properties);
};
