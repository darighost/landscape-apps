import bigInt from 'big-integer';
import _ from 'lodash';
import { decToUd, udToDec, unixToDa } from '@urbit/api';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Poke } from '@urbit/http-api';
import create from 'zustand';
import { QueryKey, useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Flag } from '@/types/hark';
import {
  Channels,
  PostAction,
  Channel,
  Perm,
  Memo,
  Reply,
  Action,
  DisplayMode,
  SortMode,
  Said,
  Create,
  Unreads,
  PostEssay,
  Posts,
  ChannelsResponse,
  ChannelsAction,
  Post,
  Nest,
  PageTuple,
  UnreadUpdate,
  PagedPosts,
  PostDataResponse,
  ChannelScan,
  ChannelScanItem,
  ReferenceResponse,
  ReplyTuple,
  newChatMap,
  HiddenPosts,
  TogglePost,
  ChannelsSubscribeResponse,
} from '@/types/channel';
import api from '@/api';
import { checkNest, log, nestToFlag } from '@/logic/utils';
import useReactQuerySubscription from '@/logic/useReactQuerySubscription';
import useReactQueryScry from '@/logic/useReactQueryScry';
import useReactQuerySubscribeOnce from '@/logic/useReactQuerySubscribeOnce';
import { INITIAL_MESSAGE_FETCH_PAGE_SIZE } from '@/constants';
import queryClient from '@/queryClient';
import { useChatStore } from '@/chat/useChatStore';
import asyncCallWithTimeout from '@/logic/asyncWithTimeout';
import channelKey, { ChannnelKeys } from './keys';

async function updatePostInCache(
  variables: { nest: Nest; postId: string },
  updater: (post: PostDataResponse | undefined) => PostDataResponse | undefined
) {
  const [han, flag] = nestToFlag(variables.nest);
  await queryClient.cancelQueries([han, 'posts', flag, variables.postId]);

  queryClient.setQueryData([han, 'posts', flag, variables.postId], updater);
}

interface PostsInCachePrev {
  pages: PagedPosts[];
  pageParams: PageParam[];
}

async function updatePostsInCache(
  variables: { nest: Nest },
  updater: (
    prev: PostsInCachePrev | undefined
  ) => { pageParams: PageParam[]; pages: PagedPosts[] } | undefined
) {
  const [han, flag] = nestToFlag(variables.nest);
  await queryClient.cancelQueries([han, 'posts', flag, 'infinite']);

  queryClient.setQueryData([han, 'posts', flag, 'infinite'], updater);
}

export function channelAction(
  nest: Nest,
  action: Action
): Poke<ChannelsAction> {
  checkNest(nest);
  return {
    app: 'channels',
    mark: 'channel-action',
    json: {
      channel: {
        nest,
        action,
      },
    },
  };
}

export function channelPostAction(nest: Nest, action: PostAction) {
  checkNest(nest);

  return channelAction(nest, {
    post: action,
  });
}

export type PostStatus = 'pending' | 'sent' | 'delivered';

export interface TrackedPost {
  cacheId: CacheId;
  status: PostStatus;
}

export interface CacheId {
  author: string;
  sent: number;
}

export interface State {
  trackedPosts: TrackedPost[];
  addTracked: (id: CacheId) => void;
  updateStatus: (id: CacheId, status: PostStatus) => void;
  getStatus: (id: CacheId) => PostStatus;
  [key: string]: unknown;
}

export const usePostsStore = create<State>((set, get) => ({
  trackedPosts: [],
  addTracked: (id) => {
    set((state) => ({
      trackedPosts: [{ status: 'pending', cacheId: id }, ...state.trackedPosts],
    }));
  },
  updateStatus: (id, s) => {
    log('setting status', s);
    set((state) => ({
      trackedPosts: state.trackedPosts.map(({ cacheId, status }) => {
        if (_.isEqual(cacheId, id)) {
          return { status: s, cacheId };
        }

        return { status, cacheId };
      }),
    }));
  },
  getStatus: (id) => {
    const { trackedPosts } = get();

    const post = trackedPosts.find(
      ({ cacheId }) => cacheId.author === id.author && cacheId.sent === id.sent
    );

    return post?.status ?? 'delivered';
  },
}));

export function useTrackedPosts() {
  return usePostsStore((s) => s.trackedPosts);
}

export function useIsPostPending(cacheId: CacheId) {
  return usePostsStore((s) =>
    s.trackedPosts.some(
      ({ status: postStatus, cacheId: nId }) =>
        postStatus === 'pending' &&
        nId.author === cacheId.author &&
        nId.sent === cacheId.sent
    )
  );
}

export function useTrackedPostStatus(cacheId: CacheId) {
  return usePostsStore(
    (s) =>
      s.trackedPosts.find(
        ({ cacheId: nId }) =>
          nId.author === cacheId.author && nId.sent === cacheId.sent
      )?.status || 'delivered'
  );
}

export function useIsPostUndelivered(post: Post | undefined) {
  const stubbedCacheId = { author: '~zod', sent: 0 };
  const cacheId =
    post && post.essay
      ? { author: post.essay.author, sent: post.essay.sent }
      : stubbedCacheId;
  const status = useTrackedPostStatus(cacheId);
  return status !== 'delivered';
}

export function usePostsOnHost(
  nest: Nest,
  enabled: boolean
): Posts | undefined {
  const [han, flag] = nestToFlag(nest);
  const { data } = useReactQueryScry({
    queryKey: [han, 'posts', 'live', flag],
    app: 'channels',
    path: `/${nest}/posts/newest/${INITIAL_MESSAGE_FETCH_PAGE_SIZE}/outline`,
    priority: 2,
    options: {
      cacheTime: 0,
      enabled,
      refetchInterval: 1000,
    },
  });

  if (
    data === undefined ||
    data === null ||
    Object.entries(data as object).length === 0
  ) {
    return undefined;
  }

  return data as Posts;
}

const infinitePostUpdater = (
  queryKey: QueryKey,
  data: ChannelsResponse,
  initialTime?: string
) => {
  const { nest, response } = data;

  if (!('post' in response)) {
    return;
  }

  const postResponse = response.post['r-post'];
  const { id } = response.post;
  const time = decToUd(id);

  if ('set' in postResponse) {
    const post = postResponse.set;

    if (post === null) {
      queryClient.setQueryData<{
        pages: PagedPosts[];
        pageParams: PageParam[];
      }>(queryKey, (d: PostsInCachePrev | undefined) => {
        if (d === undefined) {
          return undefined;
        }

        const newPages = d.pages.map((page) => {
          const newPage = {
            ...page,
          };

          const inPage =
            Object.keys(newPage.posts).some((k) => k === time) ?? false;

          if (inPage) {
            const pagePosts = { ...newPage.posts };

            pagePosts[time] = null;

            newPage.posts = pagePosts;
          }

          return newPage;
        });

        return {
          pages: newPages,
          pageParams: d.pageParams,
        };
      });
    } else {
      queryClient.setQueryData<{
        pages: PagedPosts[];
        pageParams: PageParam[];
      }>(queryKey, (d: PostsInCachePrev | undefined) => {
        if (d === undefined) {
          return {
            pages: [
              {
                posts: {
                  [time]: post,
                },
                newer: null,
                older: null,
                total: 1,
              },
            ],
            pageParams: [],
          };
        }

        const firstPage = _.first(d.pages);

        if (firstPage === undefined) {
          return undefined;
        }

        const newPosts = {
          ...firstPage.posts,
          [time]: post,
        };

        const newFirstpage: PagedPosts = {
          ...firstPage,
          posts: newPosts,
          total: firstPage.total + 1,
        };

        const cachedPost =
          firstPage.posts[decToUd(unixToDa(post.essay.sent).toString())];

        if (
          cachedPost &&
          id !== udToDec(unixToDa(post.essay.sent).toString())
        ) {
          // remove cached post if it exists
          delete newFirstpage.posts[
            decToUd(unixToDa(post.essay.sent).toString())
          ];

          // set delivered now that we have the real post
          usePostsStore
            .getState()
            .updateStatus(
              { author: post.essay.author, sent: post.essay.sent },
              'delivered'
            );
        }

        return {
          pages: [newFirstpage, ...d.pages.slice(1, d.pages.length)],
          pageParams: d.pageParams,
        };
      });
    }
  } else if ('reacts' in postResponse) {
    queryClient.setQueryData<{
      pages: PagedPosts[];
      pageParams: PageParam[];
    }>(
      queryKey,
      (d: { pages: PagedPosts[]; pageParams: PageParam[] } | undefined) => {
        if (d === undefined) {
          return undefined;
        }

        const { reacts } = postResponse;

        const newPages = d.pages.map((page) => {
          const newPage = {
            ...page,
          };

          const inPage =
            Object.keys(newPage.posts).some((k) => k === time) ?? false;

          if (inPage) {
            const post = newPage.posts[time];
            if (!post) {
              return newPage;
            }
            newPage.posts[time] = {
              ...post,
              seal: {
                ...post.seal,
                reacts,
              },
            };

            return newPage;
          }

          return newPage;
        });

        return {
          pages: newPages,
          pageParams: d.pageParams,
        };
      }
    );
  } else if ('essay' in postResponse) {
    queryClient.setQueryData<{
      pages: PagedPosts[];
      pageParams: PageParam[];
    }>(
      queryKey,
      (d: { pages: PagedPosts[]; pageParams: PageParam[] } | undefined) => {
        if (d === undefined) {
          return undefined;
        }

        const { essay } = postResponse;

        const newPages = d.pages.map((page) => {
          const newPage = {
            ...page,
          };

          const inPage =
            Object.keys(newPage.posts).some((k) => k === time) ?? false;

          if (inPage) {
            const post = newPage.posts[time];
            if (!post) {
              return page;
            }
            newPage.posts[time] = {
              ...post,
              essay,
            };

            return newPage;
          }

          return newPage;
        });

        return {
          pages: newPages,
          pageParams: d.pageParams,
        };
      }
    );
  } else if ('reply' in postResponse) {
    const {
      reply: {
        meta: { replyCount, lastReply, lastRepliers },
        'r-reply': reply,
      },
    } = postResponse;

    const [han, flag] = nestToFlag(nest);

    const replyQueryKey = [han, 'posts', flag, udToDec(time.toString())];

    if (reply && 'set' in reply) {
      if (reply.set === null) {
        queryClient.setQueryData<PostDataResponse | undefined>(
          replyQueryKey,
          (post: PostDataResponse | undefined) => {
            if (post === undefined) {
              return undefined;
            }

            const existingReplies = post.seal.replies ?? {};

            const newReplies = Object.keys(existingReplies)
              .filter((k) => k !== reply.set?.seal.id)
              .reduce((acc, k) => {
                // eslint-disable-next-line no-param-reassign
                acc[k] = existingReplies[k];
                return acc;
              }, {} as { [key: string]: Reply });

            const newPost = {
              ...post,
              seal: {
                ...post.seal,
                replies: newReplies,
                meta: {
                  ...post.seal.meta,
                  replyCount,
                  lastReply,
                  lastRepliers,
                },
              },
            };

            return newPost;
          }
        );
      } else if ('memo' in reply.set) {
        const newReply = reply.set;

        queryClient.setQueryData<PostDataResponse | undefined>(
          replyQueryKey,
          (post: PostDataResponse | undefined) => {
            if (post === undefined) {
              return undefined;
            }

            const existingReplies = post.seal.replies ?? {};

            const existingCachedReply =
              existingReplies[decToUd(unixToDa(newReply.memo.sent).toString())];

            if (existingCachedReply) {
              // remove cached reply if it exists
              delete existingReplies[
                decToUd(unixToDa(newReply.memo.sent).toString())
              ];
            }

            const newReplies = {
              ...existingReplies,
              [decToUd(newReply.seal.id)]: newReply,
            };

            const newPost = {
              ...post,
              seal: {
                ...post.seal,
                replies: newReplies,
                meta: {
                  ...post.seal.meta,
                  replyCount,
                  lastReply,
                  lastRepliers,
                },
              },
            };

            return newPost;
          }
        );

        usePostsStore.getState().updateStatus(
          {
            author: newReply.memo.author,
            sent: newReply.memo.sent,
          },
          'delivered'
        );
      }
    }

    queryClient.setQueryData<{
      pages: PagedPosts[];
      pageParams: PageParam[];
    }>(
      queryKey,
      (d: { pages: PagedPosts[]; pageParams: PageParam[] } | undefined) => {
        if (d === undefined) {
          return undefined;
        }

        const newPages = d.pages.map((page) => {
          const newPage = {
            ...page,
          };

          const inPage =
            Object.keys(newPage.posts).some((k) => k === time.toString()) ??
            false;

          if (inPage) {
            const post = newPage.posts[time.toString()];
            if (!post) {
              return newPage;
            }
            newPage.posts[time.toString()] = {
              ...post,
              seal: {
                ...post.seal,
                meta: {
                  ...post.seal.meta,
                  replyCount,
                  lastReply,
                  lastRepliers,
                },
              },
            };

            return newPage;
          }

          return newPage;
        });

        return {
          pages: newPages,
          pageParams: d.pageParams,
        };
      }
    );
  }
};

type PageParam = null | {
  time: string;
  direction: string;
};

export function useInfinitePosts(nest: Nest, initialTime?: string) {
  const [han, flag] = nestToFlag(nest);
  const queryKey = useMemo(() => [han, 'posts', flag, 'infinite'], [han, flag]);

  const invalidate = useRef(
    _.debounce(
      (event: ChannelsResponse) => {
        queryClient.invalidateQueries({
          queryKey,
          refetchType:
            event.response && 'posts' in event.response ? 'active' : 'none',
        });
      },
      300,
      {
        leading: true,
        trailing: true,
      }
    )
  );

  useEffect(() => {
    api.subscribe({
      app: 'channels',
      path: `/${nest}`,
      event: (data: ChannelsResponse) => {
        infinitePostUpdater(queryKey, data, initialTime);
        invalidate.current(data);
      },
    });
  }, [nest, invalidate, queryKey, initialTime]);

  const { data, ...rest } = useInfiniteQuery<PagedPosts>({
    queryKey,
    queryFn: async ({ pageParam }: { pageParam?: PageParam }) => {
      let path = '';

      if (pageParam) {
        const { time, direction } = pageParam;
        const ud = decToUd(time);
        path = `/${nest}/posts/${direction}/${ud}/${INITIAL_MESSAGE_FETCH_PAGE_SIZE}/outline`;
      } else if (initialTime) {
        path = `/${nest}/posts/around/${decToUd(initialTime)}/${
          INITIAL_MESSAGE_FETCH_PAGE_SIZE / 2
        }/outline`;
      } else {
        path = `/${nest}/posts/newest/${INITIAL_MESSAGE_FETCH_PAGE_SIZE}/outline`;
      }

      const response = await api.scry<PagedPosts>({
        app: 'channels',
        path,
      });

      return {
        ...response,
      };
    },
    getNextPageParam: (lastPage): PageParam | undefined => {
      const { older } = lastPage;

      if (!older) {
        return undefined;
      }

      return {
        time: older,
        direction: 'older',
      };
    },
    getPreviousPageParam: (firstPage): PageParam | undefined => {
      const { newer } = firstPage;

      if (!newer) {
        return undefined;
      }

      return {
        time: newer,
        direction: 'newer',
      };
    },
    refetchOnMount: true,
    retryOnMount: true,
    retry: false,
  });

  // we stringify the data here so that we can use it in useMemo's dependency array.
  // this is because the data object is a reference and react will not
  // do a deep comparison on it.
  const stringifiedData = data ? JSON.stringify(data) : JSON.stringify({});

  const posts: PageTuple[] = useMemo(() => {
    if (data === undefined || data.pages.length === 0) {
      return [];
    }

    return _.uniqBy(
      data.pages
        .map((page) => {
          const pagePosts = Object.entries(page.posts).map(
            ([k, v]) => [bigInt(udToDec(k)), v] as PageTuple
          );

          return pagePosts;
        })
        .flat(),
      ([k]) => k.toString()
    ).sort(([a], [b]) => a.compare(b));
    // we disable exhaustive deps here because we add stringifiedData
    // to the dependency array to force a re-render when the data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stringifiedData, data]);

  return {
    data,
    posts,
    ...rest,
  };
}

function removePostFromInfiniteQuery(nest: string, time: string) {
  const [han, flag] = nestToFlag(nest);
  const queryKey = [han, 'posts', flag, 'infinite'];
  const deletedId = decToUd(time);
  const currentData = queryClient.getQueryData(queryKey) as any;
  const newPages =
    currentData?.pages.map((page: any) =>
      page.filter(([id]: any) => id !== deletedId)
    ) ?? [];
  queryClient.setQueryData(queryKey, (data: any) => ({
    pages: newPages,
    pageParams: data.pageParams,
  }));
}

export async function prefetchPostWithComments({
  nest,
  time,
}: {
  nest: Nest;
  time: string;
}) {
  const ud = decToUd(time);
  const [han] = nestToFlag(nest);
  const data = (await api.scry({
    app: 'channels',
    path: `/${nest}/posts/post/${ud}`,
  })) as Post;
  if (data) {
    queryClient.setQueryData([han, nest, 'posts', time, 'withComments'], data);
  }
}

export function useReplyPost(nest: Nest, id: string | null) {
  const { posts } = useInfinitePosts(nest);

  return id && posts.find(([k, v]) => k.eq(bigInt(id)));
}

export function useOrderedPosts(
  nest: Nest,
  currentId: bigInt.BigInteger | string
) {
  checkNest(nest);
  const { posts } = useInfinitePosts(nest);

  if (posts.length === 0) {
    return {
      hasNext: false,
      hasPrev: false,
      nextPost: null,
      prevPost: null,
      sortedOutlines: [],
    };
  }

  const sortedOutlines = posts;

  sortedOutlines.sort(([a], [b]) => b.compare(a));

  const postId = typeof currentId === 'string' ? bigInt(currentId) : currentId;
  const newest = posts[posts.length - 1]?.[0];
  const oldest = posts[0]?.[0];
  const hasNext = posts.length > 0 && newest && postId.gt(newest);
  const hasPrev = posts.length > 0 && oldest && postId.lt(oldest);
  const currentIdx = sortedOutlines.findIndex(([i, _c]) => i.eq(postId));

  const nextPost = hasNext ? sortedOutlines[currentIdx - 1] : null;
  if (nextPost) {
    prefetchPostWithComments({
      nest,
      time: udToDec(nextPost[0].toString()),
    });
  }
  const prevPost = hasPrev ? sortedOutlines[currentIdx + 1] : null;
  if (prevPost) {
    prefetchPostWithComments({
      nest,
      time: udToDec(prevPost[0].toString()),
    });
  }

  return {
    hasNext,
    hasPrev,
    nextPost,
    prevPost,
    sortedOutlines,
  };
}

const emptyChannels: Channels = {};
export function useChannels(): Channels {
  const invalidate = useRef(
    _.debounce(
      (event: ChannelsResponse) => {
        const postEvent =
          event.response &&
          ('post' in event.response || 'posts' in event.response);
        queryClient.invalidateQueries({
          queryKey: channelKey(),
          refetchType: postEvent ? 'none' : 'active',
        });
      },
      300,
      { leading: true, trailing: true }
    )
  );

  const eventHandler = useCallback((event: ChannelsSubscribeResponse) => {
    if ('hide' in event) {
      queryClient.setQueryData<HiddenPosts>(
        ['channels', 'hidden'],
        (d: HiddenPosts | undefined) => {
          if (d === undefined) {
            return [event.hide];
          }

          const newHidden = [...d, event.hide];

          return newHidden;
        }
      );
    }

    if ('show' in event) {
      queryClient.setQueryData<HiddenPosts>(
        ['channels', 'hidden'],
        (d: HiddenPosts | undefined) => {
          if (d === undefined) {
            return undefined;
          }

          const newHidden = d.filter((h) => h !== event.show);

          return newHidden;
        }
      );
    }

    if ('response' in event && 'post' in event.response) {
      // We call infinitePostUpdater here because there are situations where we
      // are only listening to useChannels and not useInfinitePosts. This is
      // the case in threads on mobile in particular.
      const { nest } = event;
      const [han, flag] = nestToFlag(nest);
      const infinitePostQueryKey = [han, 'posts', flag, 'infinite'];
      infinitePostUpdater(infinitePostQueryKey, event);
    }

    invalidate.current(event);
  }, []);

  const { data, ...rest } = useReactQuerySubscription<
    Channels,
    ChannelsSubscribeResponse
  >({
    queryKey: channelKey(),
    app: 'channels',
    path: '/',
    scry: '/channels',
    options: {
      refetchOnMount: false,
    },
    onEvent: eventHandler,
  });

  if (rest.isLoading || rest.isError || data === undefined) {
    return emptyChannels;
  }

  return data;
}

export function useChannel(nest: Nest): Channel | undefined {
  checkNest(nest);
  const channels = useChannels();

  return channels[nest];
}

const defaultPerms = {
  writers: [],
};

export function useArrangedPosts(nest: Nest): string[] {
  checkNest(nest);
  const channel = useChannel(nest);

  if (channel === undefined || channel.order === undefined) {
    return [];
  }

  return channel.order;
}

export function usePerms(nest: Nest): Perm {
  const channel = useChannel(nest);

  const [_han, flag] = nestToFlag(nest);

  if (channel === undefined) {
    return {
      group: flag,
      ...defaultPerms,
    };
  }

  return channel.perms as Perm;
}

export function usePost(nest: Nest, postId: string, disabled = false) {
  const [han, flag] = nestToFlag(nest);

  const queryKey = useMemo(
    () => [han, 'posts', flag, postId],
    [han, flag, postId]
  );

  const scryPath = useMemo(
    () => `/${nest}/posts/post/${decToUd(postId)}`,
    [nest, postId]
  );

  const subPath = useMemo(() => `/${nest}`, [nest]);

  const enabled = useMemo(
    () => postId !== '0' && postId !== '' && nest !== '' && !disabled,
    [postId, nest, disabled]
  );
  const { data, ...rest } = useReactQuerySubscription({
    queryKey,
    app: 'channels',
    scry: scryPath,
    path: subPath,
    options: {
      enabled,
    },
  });

  const post = data as PostDataResponse;

  const replies = post?.seal?.replies;

  if (replies === undefined || Object.entries(replies).length === 0) {
    return {
      post: {
        ...post,
        seal: {
          ...post?.seal,
          replies: [] as ReplyTuple[],
          lastReply: null,
        },
      },
      ...rest,
    };
  }

  const diff: ReplyTuple[] = Object.entries(replies).map(([k, v]) => [
    bigInt(udToDec(k)),
    v as Reply,
  ]);

  const postWithReplies: Post = {
    ...post,
    seal: {
      ...post?.seal,
      replies: diff,
    },
  };

  return {
    post: postWithReplies,
    ...rest,
  };
}

export function useReply(
  nest: Nest,
  postId: string,
  replyId: string,
  isScrolling = false
) {
  checkNest(nest);

  const { post } = usePost(nest, postId, isScrolling);
  return useMemo(() => {
    if (post === undefined) {
      return undefined;
    }
    if (post.seal.replies === null || post.seal.replies.length === undefined) {
      return undefined;
    }
    const reply = post.seal.replies.find(
      ([k]) => k.toString() === replyId
    )?.[1];
    return reply;
  }, [post, replyId]);
}

export function useMarkReadMutation() {
  const mutationFn = async (variables: { nest: Nest }) => {
    checkNest(variables.nest);

    await api.poke(channelAction(variables.nest, { read: null }));
  };

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries(['unreads']);
    },
  });
}

const emptyUnreads: Unreads = {};
export function useUnreads(): Unreads {
  const { mutate: markRead } = useMarkReadMutation();
  const invalidate = useRef(
    _.debounce(
      () => {
        queryClient.invalidateQueries({
          queryKey: ['unreads'],
          refetchType: 'none',
        });
      },
      300,
      { leading: true, trailing: true }
    )
  );

  const eventHandler = (event: UnreadUpdate) => {
    const { nest, unread } = event;

    if (unread !== null) {
      const [app, flag] = nestToFlag(nest);

      if (app === 'chat') {
        if (unread['unread-id'] === null && unread.count === 0) {
          // if unread is null and count is 0, we can assume that the channel
          // has been read and we can remove it from the unreads list
          useChatStore.getState().read(flag);
        } else {
          useChatStore
            .getState()
            .unread(flag, unread, () => markRead({ nest: `chat/${flag}` }));
        }
      }

      queryClient.setQueryData(['unreads'], (d: Unreads | undefined) => {
        if (d === undefined) {
          return undefined;
        }

        const newUnreads = { ...d };
        newUnreads[event.nest] = unread;

        return newUnreads;
      });
    }

    invalidate.current();
  };

  const { data, ...rest } = useReactQuerySubscription<Unreads, UnreadUpdate>({
    queryKey: ['unreads'],
    app: 'channels',
    path: '/unreads',
    scry: '/unreads',
    onEvent: eventHandler,
  });

  if (rest.isLoading || rest.isError || data === undefined) {
    return emptyUnreads;
  }

  return data as Unreads;
}

export function useIsJoined(nest: Nest) {
  checkNest(nest);
  const unreads = useUnreads();

  return Object.keys(unreads).includes(nest);
}

export function useUnread(nest: Nest) {
  checkNest(nest);

  const unreads = useUnreads();

  return unreads[nest];
}

export function useChats(): Channels {
  const channels = useChannels();

  const chatKeys = Object.keys(channels).filter((k) => k.startsWith('chat/'));

  const chats: Channels = {};

  chatKeys.forEach((k) => {
    chats[k] = channels[k];
  });

  return chats;
}

export function useDisplayMode(nest: string): DisplayMode {
  checkNest(nest);
  const channel = useChannel(nest);
  return channel?.view ?? 'list';
}

export function useSortMode(nest: string): SortMode {
  checkNest(nest);
  const channel = useChannel(nest);
  return channel?.sort ?? 'time';
}

export function useRemotePost(
  nest: Nest,
  id: string,
  blockLoad: boolean,
  replyId?: string
) {
  checkNest(nest);
  const [han, flag] = nestToFlag(nest);
  const path = `/said/${nest}/post/${decToUd(id)}${
    replyId ? `/${decToUd(replyId)}` : ''
  }`;

  const { data, ...rest } = useReactQuerySubscribeOnce({
    queryKey: [han, 'said', nest, id, replyId],
    app: 'channels',
    path,
    options: {
      enabled: !blockLoad,
    },
  });

  if (rest.isLoading || rest.isError || data === undefined) {
    return {
      reference: undefined,
      ...rest,
    };
  }

  if (data === null) {
    return {
      reference: null,
      ...rest,
    };
  }

  const { reference } = data as Said;

  return {
    reference,
    ...rest,
  };
}

export function usePostKeys(nest: Nest) {
  const { posts } = useInfinitePosts(nest);

  return useMemo(() => posts.map(([k]) => k), [posts]);
}

export function useGetFirstUnreadID(nest: Nest) {
  const keys = usePostKeys(nest);
  const unread = useUnread(nest);

  const { 'unread-id': lastRead } = unread;

  if (!lastRead) {
    return null;
  }

  const lastReadBN = bigInt(lastRead);
  const firstUnread = keys.find((key) => key.gt(lastReadBN));
  return firstUnread ?? null;
}

export function useJoinMutation() {
  const mutationFn = async ({ group, chan }: { group: Flag; chan: Nest }) => {
    if (chan.split('/').length !== 3) {
      throw new Error('Invalid nest');
    }

    await api.trackedPoke<ChannelsAction, ChannelsResponse>(
      channelAction(chan, {
        join: group,
      }),
      { app: 'channels', path: '/' },
      (event) => event.nest === chan && 'create' in event.response
    );
  };

  return useMutation(mutationFn);
}

export function useLeaveMutation() {
  const mutationFn = async (variables: { nest: Nest }) => {
    checkNest(variables.nest);
    await api.poke(channelAction(variables.nest, { leave: null }));
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      const [han, flag] = nestToFlag(variables.nest);
      await queryClient.cancelQueries(channelKey());
      await queryClient.cancelQueries(['unreads']);
      await queryClient.cancelQueries([han, 'perms', flag]);
      await queryClient.cancelQueries([han, 'posts', flag]);
      queryClient.removeQueries([han, 'perms', flag]);
      queryClient.removeQueries([han, 'posts', flag]);
    },
    onSettled: async (_data, _error) => {
      await queryClient.invalidateQueries(channelKey());
      await queryClient.invalidateQueries(['unreads']);
    },
  });
}

export function useViewMutation() {
  const mutationFn = async (variables: { nest: Nest; view: DisplayMode }) => {
    checkNest(variables.nest);
    await api.poke(channelAction(variables.nest, { view: variables.view }));
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries(channelKey());

      const prev = queryClient.getQueryData<{ [nest: Nest]: Channel }>([
        'channels',
      ]);

      if (prev !== undefined) {
        queryClient.setQueryData<{ [nest: Nest]: Channel }>(channelKey(), {
          ...prev,
          [variables.nest]: {
            ...prev[variables.nest],
            view: variables.view,
          },
        });
      }
    },
  });
}

export function useSortMutation() {
  const mutationFn = async (variables: { nest: Nest; sort: SortMode }) => {
    await api.poke(channelAction(variables.nest, { sort: variables.sort }));
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      checkNest(variables.nest);

      await queryClient.cancelQueries(channelKey());

      const prev = queryClient.getQueryData<{ [nest: Nest]: Channel }>([
        'channels',
      ]);

      if (prev !== undefined) {
        queryClient.setQueryData<{ [nest: Nest]: Channel }>(channelKey(), {
          ...prev,
          [variables.nest]: {
            ...prev[variables.nest],
            sort: variables.sort,
          },
        });
      }
    },
  });
}

export function useArrangedPostsMutation() {
  const { mutate: changeSortMutation } = useSortMutation();

  const mutationFn = async (variables: {
    nest: Nest;
    arrangedPosts: string[];
  }) => {
    checkNest(variables.nest);

    // change sort mode automatically if arrangedPosts is empty/not-empty
    if (variables.arrangedPosts.length === 0) {
      changeSortMutation({ nest: variables.nest, sort: 'time' });
    } else {
      changeSortMutation({ nest: variables.nest, sort: 'arranged' });
    }

    await api.poke(
      channelAction(variables.nest, {
        order: variables.arrangedPosts.map((t) => decToUd(t)),
      })
    );
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries(channelKey());

      const prev = queryClient.getQueryData<{ [nest: Nest]: Channel }>([
        'channels',
      ]);

      if (prev !== undefined) {
        queryClient.setQueryData<{ [nest: Nest]: Channel }>(channelKey(), {
          ...prev,
          [variables.nest]: {
            ...prev[variables.nest],
            order: variables.arrangedPosts.map((t) => decToUd(t)),
          },
        });
      }
    },
  });
}

export function useAddPostMutation(nest: string) {
  const [han, flag] = nestToFlag(nest);
  const queryKey = useCallback(
    (...args: any[]) => [han, 'posts', flag, ...args],
    [han, flag]
  );

  let timePosted: string;
  const mutationFn = async (variables: {
    cacheId: CacheId;
    essay: PostEssay;
    tracked?: boolean;
  }) => {
    if (!variables.tracked) {
      // If we use a trackedPoke here then the trackedPost status will be updated
      // out of order. So we use a normal poke.
      return api.poke(
        channelPostAction(nest, {
          add: variables.essay,
        })
      );
    }

    // for diary notes, we want to wait for the post to get an ID back from the backend.
    return asyncCallWithTimeout(
      new Promise<string>((resolve) => {
        try {
          api
            .trackedPoke<ChannelsAction, ChannelsResponse>(
              channelPostAction(nest, {
                add: variables.essay,
              }),
              { app: 'channels', path: `/${nest}` },
              ({ response }) => {
                if ('post' in response) {
                  const { id, 'r-post': postResponse } = response.post;
                  if (
                    'set' in postResponse &&
                    postResponse.set !== null &&
                    postResponse.set.essay.author === variables.essay.author &&
                    postResponse.set.essay.sent === variables.essay.sent
                  ) {
                    timePosted = id;
                    return true;
                  }
                  return true;
                }

                return false;
              }
            )
            .then(() => {
              resolve(timePosted);
            });
        } catch (e) {
          console.error(e);
        }
      }),
      15000
    );
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries(queryKey());

      usePostsStore.getState().addTracked(variables.cacheId);

      const sent = unixToDa(variables.essay.sent).toString();
      const post = {
        seal: {
          id: sent,
          replies: {},
          reacts: {},
          meta: {
            replyCount: 0,
            lastRepliers: [],
            lastReply: null,
          },
        },
        essay: variables.essay,
      };

      queryClient.setQueryData<PostDataResponse>(
        queryKey(variables.cacheId),
        post
      );

      infinitePostUpdater(queryKey('infinite'), {
        nest,
        response: {
          post: {
            id: sent,
            'r-post': {
              set: {
                ...post,
                seal: {
                  ...post.seal,
                  replies: null,
                },
              },
            },
          },
        },
      });
    },
    onSuccess: async (_data, variables) => {
      const status = usePostsStore.getState().getStatus(variables.cacheId);
      if (status === 'pending') {
        usePostsStore.getState().updateStatus(variables.cacheId, 'sent');
      }
      queryClient.removeQueries(queryKey(variables.cacheId));
    },
    onError: async (_error, variables, context) => {
      usePostsStore.setState((state) => ({
        ...state,
        trackedPosts: state.trackedPosts.filter(
          (p) => p.cacheId !== variables.cacheId
        ),
      }));

      queryClient.setQueryData(queryKey(variables.cacheId), undefined);
    },
    onSettled: async (_data, _error) => {
      await queryClient.invalidateQueries({
        queryKey: queryKey('infinite'),
        refetchType: 'none',
      });
    },
  });
}

export function useEditPostMutation() {
  const mutationFn = async (variables: {
    nest: Nest;
    time: string;
    essay: PostEssay;
  }) => {
    checkNest(variables.nest);

    asyncCallWithTimeout(
      api.poke(
        channelPostAction(variables.nest, {
          edit: {
            id: decToUd(variables.time),
            essay: variables.essay,
          },
        })
      ),
      15000
    );
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      const updater = (prev: PostDataResponse | undefined) => {
        if (prev === undefined) {
          return prev;
        }

        return {
          ...prev,
          essay: variables.essay,
        };
      };

      const postsUpdater = (prev: PostsInCachePrev | undefined) => {
        if (prev === undefined) {
          return prev;
        }

        if (prev.pages === undefined) {
          return prev;
        }

        const allPostsInCache = prev.pages.flatMap((page) =>
          Object.entries(page.posts)
        );

        const prevPost = allPostsInCache.find(
          ([k]) => k === decToUd(variables.time)
        )?.[1];

        if (prevPost === null || prevPost === undefined) {
          return prev;
        }

        const pageInCache = prev.pages.find((page) =>
          Object.keys(page.posts).some((k) => k === decToUd(variables.time))
        );

        const pageInCacheIdx = prev.pages.findIndex((page) =>
          Object.keys(page.posts).some((k) => k === decToUd(variables.time))
        );

        if (pageInCache === undefined) {
          return prev;
        }

        return {
          ...prev,
          pages: [
            ...prev.pages.slice(0, pageInCacheIdx),
            {
              ...pageInCache,
              posts: {
                ...pageInCache?.posts,
                [decToUd(variables.time)]: {
                  ...prevPost,
                  essay: variables.essay,
                  seal: prevPost.seal,
                },
              },
            },
            ...prev.pages.slice(pageInCacheIdx + 1),
          ],
        };
      };

      await updatePostInCache(
        {
          nest: variables.nest,
          postId: variables.time,
        },
        updater
      );

      await updatePostsInCache(variables, postsUpdater);
    },
    onSettled: async (_data, _error, variables) => {
      const [han, flag] = nestToFlag(variables.nest);
      await queryClient.invalidateQueries({
        queryKey: [han, 'posts', flag, variables.time],
        refetchType: 'none',
      });
      await queryClient.invalidateQueries({
        queryKey: [han, 'posts', flag, 'infinite'],
      });
    },
  });
}

export function useDeletePostMutation() {
  const mutationFn = async (variables: { nest: Nest; time: string }) => {
    checkNest(variables.nest);

    await api.trackedPoke<ChannelsAction, ChannelsResponse>(
      channelPostAction(variables.nest, { del: variables.time }),
      {
        app: 'channels',
        path: `/${variables.nest}`,
      },
      (event) => {
        if ('post' in event.response) {
          const { id, 'r-post': postResponse } = event.response.post;
          return (
            id === variables.time &&
            'set' in postResponse &&
            postResponse.set === null
          );
        }
        return false;
      }
    );
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      const updater = (prev: PostsInCachePrev | undefined) => {
        if (prev === undefined) {
          return prev;
        }

        if (prev.pages === undefined) {
          return prev;
        }

        const allPostsInCache = prev.pages.flatMap((page) =>
          Object.entries(page.posts)
        );

        const prevPost = allPostsInCache.find(
          ([k]) => k === decToUd(variables.time)
        )?.[1];

        if (prevPost === null || prevPost === undefined) {
          return prev;
        }

        const pageInCache = prev.pages.find((page) =>
          Object.keys(page.posts).some((k) => k === decToUd(variables.time))
        );

        const pageInCacheIdx = prev.pages.findIndex((page) =>
          Object.keys(page.posts).some((k) => k === decToUd(variables.time))
        );

        if (pageInCache === undefined) {
          return prev;
        }

        return {
          ...prev,
          pages: [
            ...prev.pages.slice(0, pageInCacheIdx),
            {
              ...pageInCache,
              posts: Object.fromEntries(
                Object.entries(pageInCache.posts).filter(
                  ([k]) => k !== decToUd(variables.time)
                )
              ),
            },
            ...prev.pages.slice(pageInCacheIdx + 1),
          ],
        };
      };

      await updatePostsInCache(variables, updater);
    },
    onSuccess: async (_data, variables) => {
      removePostFromInfiniteQuery(variables.nest, variables.time);
    },
    onSettled: async (_data, _error, variables) => {
      const [han, flag] = nestToFlag(variables.nest);
      setTimeout(async () => {
        await queryClient.invalidateQueries([han, 'posts', flag]);
        await queryClient.invalidateQueries([han, 'posts', flag, 'infinite']);
      }, 3000);
    },
  });
}

export function useCreateMutation() {
  const mutationFn = async (variables: Create) => {
    await api.trackedPoke<ChannelsAction, ChannelsResponse>(
      {
        app: 'channels',
        mark: 'channel-action',
        json: {
          create: variables,
        },
      },
      { app: 'channels', path: '/' },
      (event) => {
        const { response, nest } = event;
        return (
          'create' in response &&
          nest === `${variables.kind}/${window.our}/${variables.name}`
        );
      }
    );
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries(channelKey());

      const prev = queryClient.getQueryData<{ [nest: Nest]: Channel }>([
        'channels',
      ]);

      if (prev !== undefined) {
        queryClient.setQueryData<{ [nest: Nest]: Channel }>(channelKey(), {
          ...prev,
          [`${variables.kind}/${window.our}/${variables.name}`]: {
            perms: { writers: [], group: variables.group },
            view: 'list',
            order: [],
            sort: 'time',
            saga: { synced: null },
          },
        });
      }
    },
    onSettled: async (_data, _error, variables) => {
      await queryClient.invalidateQueries(channelKey());
      await queryClient.invalidateQueries([
        variables.kind,
        'posts',
        `${window.our}/${variables.name}`,
        { exact: true },
      ]);
    },
  });
}

export function useAddSectsMutation() {
  const mutationFn = async (variables: { nest: Nest; writers: string[] }) => {
    await api.poke(
      channelAction(variables.nest, { 'add-writers': variables.writers })
    );
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      checkNest(variables.nest);

      await queryClient.cancelQueries(channelKey());

      const prev = queryClient.getQueryData<{ [nest: Nest]: Channel }>([
        'channels',
      ]);

      if (prev !== undefined) {
        queryClient.setQueryData<{ [nest: Nest]: Channel }>(channelKey(), {
          ...prev,
          [variables.nest]: {
            ...prev[variables.nest],
            perms: {
              ...prev[variables.nest].perms,
              writers: [
                ...prev[variables.nest].perms.writers,
                ...variables.writers,
              ],
            },
          },
        });
      }
    },
  });
}

export function useDeleteSectsMutation() {
  const mutationFn = async (variables: { nest: Nest; writers: string[] }) => {
    checkNest(variables.nest);

    await api.poke(
      channelAction(variables.nest, { 'del-writers': variables.writers })
    );
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries(channelKey());

      const prev = queryClient.getQueryData<{ [nest: Nest]: Channel }>([
        'channels',
      ]);

      if (prev !== undefined) {
        queryClient.setQueryData<{ [nest: Nest]: Channel }>(channelKey(), {
          ...prev,
          [variables.nest]: {
            ...prev[variables.nest],
            perms: {
              ...prev[variables.nest].perms,
              writers: prev[variables.nest].perms.writers.filter(
                (writer) => !variables.writers.includes(writer)
              ),
            },
          },
        });
      }
    },
  });
}

export function useAddReplyMutation() {
  const mutationFn = async (variables: {
    nest: Nest;
    postId: string;
    memo: Memo;
    cacheId: CacheId;
  }) => {
    checkNest(variables.nest);

    const replying = decToUd(variables.postId);
    const action: Action = {
      post: {
        reply: {
          id: replying,
          action: {
            add: variables.memo,
          },
        },
      },
    };

    await api.poke(channelAction(variables.nest, action));
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      usePostsStore.getState().addTracked(variables.cacheId);

      const postsUpdater = (prev: PostsInCachePrev | undefined) => {
        if (prev === undefined) {
          return prev;
        }

        const replying = decToUd(variables.postId);

        const allPostsInCache = prev.pages.flatMap((page) =>
          Object.entries(page.posts)
        );

        if (replying in allPostsInCache) {
          const replyingPost = allPostsInCache.find(
            ([k]) => k === replying
          )?.[1];
          if (replyingPost === null || replyingPost === undefined) {
            return prev;
          }

          const updatedPost = {
            ...replyingPost,
            seal: {
              ...replyingPost.seal,
              meta: {
                ...replyingPost.seal.meta,
                replyCount: replyingPost.seal.meta.replyCount + 1,
                repliers: [...replyingPost.seal.meta.lastRepliers, window.our],
              },
            },
          };

          const pageInCache = prev.pages.find((page) =>
            Object.keys(page.posts).some((k) => k === decToUd(replying))
          );

          const pageInCacheIdx = prev.pages.findIndex((page) =>
            Object.keys(page.posts).some((k) => k === decToUd(replying))
          );

          if (pageInCache === undefined) {
            return prev;
          }

          return {
            ...prev,
            pages: [
              ...prev.pages.slice(0, pageInCacheIdx),
              {
                ...pageInCache,
                posts: {
                  ...pageInCache?.posts,
                  [decToUd(replying)]: updatedPost,
                },
              },
              ...prev.pages.slice(pageInCacheIdx + 1),
            ],
          };
        }
        return prev;
      };

      const updater = (prevPost: PostDataResponse | undefined) => {
        if (prevPost === undefined) {
          return prevPost;
        }
        const prevReplies = prevPost.seal.replies;
        const newReplies: Record<string, Reply> = {
          ...prevReplies,
          [decToUd(unixToDa(variables.memo.sent).toString())]: {
            seal: {
              id: unixToDa(variables.memo.sent).toString(),
              'parent-id': variables.postId,
              reacts: {},
            },
            memo: variables.memo,
          },
        };

        const updatedPost: PostDataResponse = {
          ...prevPost,
          seal: {
            ...prevPost.seal,
            replies: newReplies,
          },
        };

        return updatedPost;
      };

      await updatePostsInCache(variables, postsUpdater);
      await updatePostInCache(variables, updater);
    },
    onSuccess: async (_data, variables) => {
      const status = usePostsStore.getState().getStatus(variables.cacheId);
      if (status === 'pending') {
        usePostsStore.getState().updateStatus(variables.cacheId, 'sent');
      }
    },
  });
}

export function useDeleteReplyMutation() {
  const mutationFn = async (variables: {
    nest: Nest;
    postId: string;
    replyId: string;
  }) => {
    checkNest(variables.nest);

    const action: Action = {
      post: {
        reply: {
          id: decToUd(variables.postId),
          action: {
            del: decToUd(variables.replyId),
          },
        },
      },
    };

    await api.poke(channelAction(variables.nest, action));
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      const postsUpdater = (prev: PostsInCachePrev | undefined) => {
        if (prev === undefined) {
          return prev;
        }
        const replying = decToUd(variables.postId);

        const allPostsInCache = prev.pages.flatMap((page) =>
          Object.entries(page.posts)
        );

        if (replying in allPostsInCache) {
          const replyingPost = allPostsInCache.find(
            ([k]) => k === replying
          )?.[1];

          if (replyingPost === null || replyingPost === undefined) {
            return prev;
          }

          const updatedPost = {
            ...replyingPost,
            seal: {
              ...replyingPost.seal,
              replyCount: replyingPost.seal.meta.replyCount - 1,
              repliers: replyingPost.seal.meta.lastRepliers.filter(
                (replier) => replier !== window.our
              ),
            },
          };

          const pageInCache = prev.pages.find((page) =>
            Object.keys(page.posts).some((k) => k === decToUd(replying))
          );

          const pageInCacheIdx = prev.pages.findIndex((page) =>
            Object.keys(page.posts).some((k) => k === decToUd(replying))
          );

          if (pageInCache === undefined) {
            return prev;
          }

          return {
            ...prev,
            pages: [
              ...prev.pages.slice(0, pageInCacheIdx),
              {
                ...pageInCache,
                posts: {
                  ...pageInCache?.posts,
                  [decToUd(replying)]: updatedPost,
                },
              },
              ...prev.pages.slice(pageInCacheIdx + 1),
            ],
          };
        }
        return prev;
      };

      const updater = (prevPost: PostDataResponse | undefined) => {
        if (prevPost === undefined) {
          return prevPost;
        }

        const prevReplies = prevPost.seal.replies;
        const newReplies = { ...prevReplies };
        delete newReplies[variables.replyId];

        const updatedPost: PostDataResponse = {
          ...prevPost,
          seal: {
            ...prevPost.seal,
            replies: newReplies,
          },
        };

        return updatedPost;
      };

      await updatePostInCache(variables, updater);
      await updatePostsInCache(variables, postsUpdater);
    },
    onSettled: async (_data, _error, variables) => {
      const [han, flag] = nestToFlag(variables.nest);
      setTimeout(async () => {
        // TODO: this is a hack to make sure the post is updated before refetching
        // the queries. We need to figure out why the post is not updated immediately.
        await queryClient.refetchQueries([
          han,
          'posts',
          flag,
          variables.postId,
        ]);
      }, 300);
    },
  });
}

export function useAddPostReactMutation() {
  const mutationFn = async (variables: {
    nest: Nest;
    postId: string;
    react: string;
  }) => {
    checkNest(variables.nest);

    const action: Action = {
      post: {
        'add-react': {
          id: decToUd(variables.postId),
          react: variables.react,
          ship: window.our,
        },
      },
    };

    await api.poke(channelAction(variables.nest, action));
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      const postsUpdater = (prev: PostsInCachePrev | undefined) => {
        if (prev === undefined) {
          return prev;
        }

        const allPostsInCache = prev.pages.flatMap((page) =>
          Object.entries(page.posts)
        );

        const prevPost = allPostsInCache.find(
          ([k]) => k === decToUd(variables.postId)
        )?.[1];

        if (prevPost === null || prevPost === undefined) {
          return prev;
        }

        const updatedPost = {
          ...prevPost,
          seal: {
            ...prevPost.seal,
            reacts: {
              ...prevPost.seal.reacts,
              [window.our]: variables.react,
            },
          },
        };

        const pageInCache = prev.pages.find((page) =>
          Object.keys(page.posts).some((k) => k === decToUd(variables.postId))
        );

        const pageInCacheIdx = prev.pages.findIndex((page) =>
          Object.keys(page.posts).some((k) => k === decToUd(variables.postId))
        );

        if (pageInCache === undefined) {
          return prev;
        }

        return {
          ...prev,
          pages: [
            ...prev.pages.slice(0, pageInCacheIdx),
            {
              ...pageInCache,
              posts: {
                ...pageInCache?.posts,
                [decToUd(variables.postId)]: updatedPost,
              },
            },
            ...prev.pages.slice(pageInCacheIdx + 1),
          ],
        };
      };

      const postUpdater = (prevPost: PostDataResponse | undefined) => {
        if (prevPost === undefined) {
          return prevPost;
        }

        const prevReacts = prevPost.seal.reacts;
        const newReacts = {
          ...prevReacts,
          [window.our]: variables.react,
        };

        const updatedPost: PostDataResponse = {
          ...prevPost,
          seal: {
            ...prevPost.seal,
            reacts: newReacts,
          },
        };

        return updatedPost;
      };

      await updatePostInCache(variables, postUpdater);

      await updatePostsInCache(variables, postsUpdater);
    },
  });
}

export function useDeletePostReactMutation() {
  const mutationFn = async (variables: { nest: Nest; postId: string }) => {
    checkNest(variables.nest);

    const action: Action = {
      post: {
        'del-react': {
          id: decToUd(variables.postId),
          ship: window.our,
        },
      },
    };

    await api.poke(channelAction(variables.nest, action));
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      const postsUpdater = (prev: PostsInCachePrev | undefined) => {
        if (prev === undefined) {
          return prev;
        }

        const allPostsInCache = prev.pages.flatMap((page) =>
          Object.entries(page.posts)
        );

        const prevPost = allPostsInCache.find(
          ([k]) => k === decToUd(variables.postId)
        )?.[1];

        if (prevPost === null || prevPost === undefined) {
          return prev;
        }

        const newReacts = {
          ...prevPost.seal.reacts,
        };

        delete newReacts[window.our];

        const updatedPost = {
          ...prevPost,
          seal: {
            ...prevPost.seal,
            reacts: newReacts,
          },
        };

        const pageInCache = prev.pages.find((page) =>
          Object.keys(page.posts).some((k) => k === decToUd(variables.postId))
        );

        const pageInCacheIdx = prev.pages.findIndex((page) =>
          Object.keys(page.posts).some((k) => k === decToUd(variables.postId))
        );

        if (pageInCache === undefined) {
          return prev;
        }

        return {
          ...prev,
          pages: [
            ...prev.pages.slice(0, pageInCacheIdx),
            {
              ...pageInCache,
              posts: {
                ...pageInCache?.posts,
                [decToUd(variables.postId)]: updatedPost,
              },
            },
            ...prev.pages.slice(pageInCacheIdx + 1),
          ],
        };
      };

      const postUpdater = (prev: PostDataResponse | undefined) => {
        if (prev === undefined) {
          return prev;
        }

        const prevReacts = prev.seal.reacts;
        const newReacts = {
          ...prevReacts,
        };
        delete newReacts[window.our];

        const updatedPost = {
          ...prev,
          seal: {
            ...prev.seal,
            reacts: newReacts,
          },
        };

        return updatedPost;
      };

      await updatePostInCache(variables, postUpdater);
      await updatePostsInCache(variables, postsUpdater);
    },
  });
}

export function useAddReplyReactMutation() {
  const mutationFn = async (variables: {
    nest: Nest;
    postId: string;
    replyId: string;
    react: string;
  }) => {
    checkNest(variables.nest);

    const action: Action = {
      post: {
        reply: {
          id: decToUd(variables.postId),
          action: {
            'add-react': {
              id: decToUd(variables.replyId),
              react: variables.react,
              ship: window.our,
            },
          },
        },
      },
    };

    await api.poke(channelAction(variables.nest, action));
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      const updater = (prev: PostDataResponse | undefined) => {
        if (prev === undefined) {
          return prev;
        }

        const { replies } = prev.seal;
        Object.entries(replies).forEach(([time, reply]) => {
          if (time === decToUd(variables.replyId)) {
            replies[decToUd(variables.replyId)] = {
              ...reply,
              seal: {
                ...reply.seal,
                reacts: {
                  ...reply.seal.reacts,
                  [window.our]: variables.react,
                },
              },
            };
          }
        });

        const updatedPost = {
          ...prev,
          seal: {
            ...prev.seal,
            replies,
          },
        };

        return updatedPost;
      };

      await updatePostInCache(variables, updater);
    },
  });
}

export function useDeleteReplyReactMutation() {
  const mutationFn = async (variables: {
    nest: Nest;
    postId: string;
    replyId: string;
  }) => {
    checkNest(variables.nest);

    const action: Action = {
      post: {
        reply: {
          id: decToUd(variables.postId),
          action: {
            'del-react': {
              id: decToUd(variables.replyId),
              ship: window.our,
            },
          },
        },
      },
    };

    await api.poke(channelAction(variables.nest, action));
  };

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      const updater = (prev: PostDataResponse | undefined) => {
        if (prev === undefined) {
          return prev;
        }
        const { replies } = prev.seal;
        Object.entries(replies).forEach(([time, reply]) => {
          if (time === decToUd(variables.replyId)) {
            const newReacts = {
              ...reply.seal.reacts,
            };
            delete newReacts[window.our];

            replies[decToUd(variables.replyId)] = {
              ...reply,
              seal: {
                ...reply.seal,
                reacts: newReacts,
              },
            };
          }
        });

        const updatedPost = {
          ...prev,
          seal: {
            ...prev.seal,
            replies,
          },
        };

        return updatedPost;
      };

      await updatePostInCache(variables, updater);
    },
    onSettled: async (_data, _error, variables) => {
      const [han, flag] = nestToFlag(variables.nest);
      await queryClient.invalidateQueries([
        han,
        'posts',
        flag,
        variables.postId,
      ]);
    },
  });
}

export function useChannelSearch(nest: string, query: string) {
  const { data, ...rest } = useInfiniteQuery({
    queryKey: ['channel', 'search', nest, query],
    enabled: query !== '',
    queryFn: async ({ pageParam = 0 }) => {
      const res = await api.scry<ChannelScan>({
        app: 'channels',
        path: `/${nest}/search/text/${
          decToUd(pageParam.toString()) || '0'
        }/20/${query}`,
      });
      return res;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length === 0) return undefined;
      return allPages.length * 20;
    },
  });

  const scan = useMemo(
    () =>
      newChatMap(
        (data?.pages || [])
          .flat()
          .map((scItem: ChannelScanItem) =>
            'post' in scItem
              ? ([bigInt(scItem.post.seal.id), scItem.post] as PageTuple)
              : ([
                  bigInt(scItem.reply.reply.seal.id),
                  scItem.reply.reply,
                ] as ReplyTuple)
          ),
        true
      ),
    [data]
  );

  return {
    scan,
    ...rest,
  };
}

export function useHiddenPosts() {
  return useReactQueryScry<HiddenPosts>({
    queryKey: ['channels', 'hidden'],
    app: 'channels',
    path: '/hidden-posts',
    options: {
      placeholderData: [],
    },
  });
}

export function useTogglePostMutation() {
  const mutationFn = (variables: { toggle: TogglePost }) =>
    api.poke({
      app: 'channels',
      mark: 'channel-action',
      json: {
        'toggle-post': variables.toggle,
      },
    });

  return useMutation(mutationFn, {
    onMutate: ({ toggle }) => {
      const hiding = 'hide' in toggle;
      queryClient.setQueryData<HiddenPosts>(['diary', 'hidden'], (prev) => {
        if (!prev) {
          return hiding ? [udToDec(toggle.hide)] : [];
        }

        return hiding
          ? [...prev, udToDec(toggle.hide)]
          : prev.filter((postId) => postId !== udToDec(toggle.show));
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['diary', 'hidden']);
    },
  });
}

export function usePostToggler(postId: string) {
  const udId = decToUd(postId);
  const { mutate } = useTogglePostMutation();
  const { data: hidden } = useHiddenPosts();
  const isHidden = useMemo(
    () => (hidden || []).some((h) => h === postId),
    [hidden, postId]
  );
  const show = useCallback(
    () => mutate({ toggle: { show: udId } }),
    [mutate, udId]
  );
  const hide = useCallback(
    () => mutate({ toggle: { hide: udId } }),
    [mutate, udId]
  );

  return {
    show,
    hide,
    isHidden,
  };
}
