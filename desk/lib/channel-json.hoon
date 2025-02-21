/-  j=joint, c=channels, g=groups
/-  meta
/+  cite=cite-json, gj=groups-json
=*  z  ..zuse
|%
++  enjs
  =,  enjs:format
  |%
  +|  %responses
  ::
  ++  r-channels
    |=  [=nest:c =r-channel:c]
    %-  pairs
    :~  nest+(^nest nest)
        response+(^r-channel r-channel)
    ==
  ::
  ++  r-channel
    |=  =r-channel:c
    %+  frond  -.r-channel
    ?-  -.r-channel
      %posts    (posts posts.r-channel)
      %post     (pairs id+(id id.r-channel) r-post+(r-post r-post.r-channel) ~)
      %order    (order order.r-channel)
      %view     s+view.r-channel
      %sort     s+sort.r-channel
      %perm     (perm perm.r-channel)
    ::
      %create   (perm perm.r-channel)
      %join     (flag group.r-channel)
      %leave    ~
      %read     ~
      %read-at  s+(scot %ud time.r-channel)
      %watch    ~
      %unwatch  ~
    ==
  ::
  ++  r-post
    |=  =r-post:c
    %+  frond  -.r-post
    ?-  -.r-post
      %set    ?~(post.r-post ~ (post u.post.r-post))
      %reacts  (reacts reacts.r-post)
      %essay  (essay essay.r-post)
    ::
        %reply
      %-  pairs
      :~  id+(id id.r-post)
          r-reply+(r-reply r-reply.r-post)
          meta+(reply-meta reply-meta.r-post)
      ==
    ==
  ::
  ++  r-reply
    |=  =r-reply:c
    %+  frond  -.r-reply
    ?-  -.r-reply
      %set    ?~(reply.r-reply ~ (reply u.reply.r-reply))
      %reacts  (reacts reacts.r-reply)
    ==
  ::
  ++  paged-posts
    |=  pn=paged-posts:c
    %-  pairs
    :~  posts+(posts posts.pn)
        newer+?~(newer.pn ~ (id u.newer.pn))
        older+?~(older.pn ~ (id u.older.pn))
        total+(numb total.pn)
    ==
  +|  %rr
  ::
  ++  channels
    |=  =channels:c
    %-  pairs
    %+  turn  ~(tap by channels)
    |=  [n=nest:c ca=channel:c]
    [(nest-cord n) (channel ca)]
  ::
  ++  channel
    |=  =channel:c
    %-  pairs
    :~  posts+(posts posts.channel)
        order+(order order.channel)
        view+s+view.channel
        sort+s+sort.channel
        perms+(perm perm.channel)
    ==
  ::
  ++  posts
    |=  =posts:c
    %-  pairs
    %+  turn  (tap:on-posts:c posts)
    |=  [id=id-post:c post=(unit post:c)]
    [(scot %ud id) ?~(post ~ (^post u.post))]
  ::
  ++  post
    |=  [=seal:c =essay:c]
    %-  pairs
    :~  seal+(^seal seal)
        essay+(^essay essay)
        type+s+%post
    ==
  ::
  ++  replies
    |=  =replies:c
    %-  pairs
    %+  turn  (tap:on-replies:c replies)
    |=  [t=@da =reply:c]
    [(scot %ud t) (^reply reply)]
  ::
  ++  reply
    |=  [=reply-seal:c =memo:c]
    %-  pairs
    :~  seal+(^reply-seal reply-seal)
        memo+(^memo memo)
    ==
  ::
  ++  seal
    |=  =seal:c
    %-  pairs
    :~  id+(id id.seal)
        reacts+(reacts reacts.seal)
        replies+(replies replies.seal)
        meta+(reply-meta reply-meta.seal)
    ==
  ::
  ++  reply-seal
    |=  =reply-seal:c
    %-  pairs
    :~  id+(id id.reply-seal)
        parent-id+(id parent-id.reply-seal)
        reacts+(reacts reacts.reply-seal)
    ==
  ::
  ++  post-toggle
    |=  p=post-toggle:c
    %+  frond  -.p
    ?-  -.p
      %hide  (id id-post.p)
      %show  (id id-post.p)
    ==
  ::
  ++  hidden-posts
    |=  hp=hidden-posts:c
    a+(turn ~(tap in hp) id)
  ::
  ::
  +|  %primitives
  ::
  ++  v-channel
    |=  ca=v-channel:c
    %-  pairs
    :~  order+(order order.order.ca)
        perms+(perm perm.perm.ca)
        view+s+view.view.ca
        sort+s+sort.sort.ca
    ==
  ::
  ++  id
    |=  =@da
    s+`@t`(rsh 4 (scot %ui da))
  ::
  ++  flag
    |=  f=flag:g
    ^-  json
    s/(rap 3 (scot %p p.f) '/' q.f ~)
  ::
  ++  nest
    |=  n=nest:c
    ^-  json
    s/(nest-cord n)
  ::
  ++  nest-cord
    |=  n=nest:c
    ^-  cord
    (rap 3 kind.n '/' (scot %p ship.n) '/' name.n ~)
  ::
  ++  ship
    |=  her=@p
    n+(rap 3 '"' (scot %p her) '"' ~)
  ::
  ++  order
    |=  a=arranged-posts:c
    :-  %a
    =/  times=(list time:z)  ?~(a ~ u.a)
    (turn times id)
  ::
  ++  perm
    |=  p=perm:c
    %-  pairs
    :~  writers/a/(turn ~(tap in writers.p) (lead %s))
        group/(flag group.p)
    ==
  ::
  ++  reacts
    |=  reacts=(map ship:z react:j)
    ^-  json
    %-  pairs
    %+  turn  ~(tap by reacts)
    |=  [her=@p =react:j]
    [(scot %p her) s+react]
  ::
  ++  essay
    |=  =essay:c
    %-  pairs
    :~  content+(story content.essay)
        author+(ship author.essay)
        sent+(time sent.essay)
        kind-data+(kind-data kind-data.essay)
    ==
  ::
  ++  kind-data
    |=  =kind-data:c
    %+  frond  -.kind-data
    ?-    -.kind-data
      %heap   ?~(title.kind-data ~ s+u.title.kind-data)
      %chat   ?~(kind.kind-data ~ (pairs notice+~ ~))
      %diary  (pairs title+s+title.kind-data image+s+image.kind-data ~)
    ==
  ::
  ++  reply-meta
    |=  r=reply-meta:c
    %-  pairs
    :~  'replyCount'^(numb reply-count.r)
        'lastReply'^?~(last-reply.r ~ (time u.last-reply.r))
        'lastRepliers'^a/(turn ~(tap in last-repliers.r) ship)
    ==
  ::
  ++  verse
    |=  =verse:c
    ^-  json
    %+  frond  -.verse
    ?-  -.verse
        %block  (block p.verse)
        %inline  a+(turn p.verse inline)
    ==
  ++  block
    |=  b=block:c
    ^-  json
    %+  frond  -.b
    ?-  -.b
        %rule  ~
        %cite  (enjs:cite cite.b)
        %listing  (listing p.b)
        %header
      %-  pairs
      :~  tag+s+p.b
          content+a+(turn q.b inline)
      ==
        %image
      %-  pairs
      :~  src+s+src.b
          height+(numb height.b)
          width+(numb width.b)
          alt+s+alt.b
      ==
        %code
      %-  pairs
      :~  code+s+code.b
          lang+s+lang.b
      ==
    ==
  ::
  ++  listing
    |=  l=listing:c
    ^-  json
    %+  frond  -.l
    ?-  -.l
        %item  a+(turn p.l inline)
        %list
      %-  pairs
      :~  type+s+p.l
          items+a+(turn q.l listing)
          contents+a+(turn r.l inline)
      ==
    ==
  ::
  ++  inline
    |=  i=inline:c
    ^-  json
    ?@  i  s+i
    %+  frond  -.i
    ?-  -.i
        %break
      ~
    ::
        %ship  s/(scot %p p.i)
    ::
        ?(%code %tag %inline-code)
      s+p.i
    ::
        ?(%italics %bold %strike %blockquote)
      :-  %a
      (turn p.i inline)
    ::
        %block
      %-  pairs
      :~  index+(numb p.i)
          text+s+q.i
      ==
    ::
        %link
      %-  pairs
      :~  href+s+p.i
          content+s+q.i
      ==
        %task
      %-  pairs
      :~  checked+b+p.i
          content+a+(turn q.i inline)
      ==
    ==
  ::
  ++  story
    |=  s=story:c
    ^-  json
    a+(turn s verse)
  ::
  ++  memo
    |=  m=memo:c
    ^-  json
    %-  pairs
    :~  content/(story content.m)
        author/(ship author.m)
        sent/(time sent.m)
    ==
  ::
  +|  %unreads
  ::
  ++  unreads
    |=  bs=unreads:c
    %-  pairs
    %+  turn  ~(tap by bs)
    |=  [n=nest:c b=unread:c]
    [(nest-cord n) (unread b)]
  ::
  ++  unread-update
    |=  u=(pair nest:c unread:c)
    %-  pairs
    :~  nest/(nest p.u)
        unread/(unread q.u)
    ==
  ::
  ++  unread
    |=  b=unread:c
    %-  pairs
    :~  recency/(time recency.b)
        count/(numb count.b)
        unread-id/?~(unread-id.b ~ (id u.unread-id.b))
        threads/(unread-threads threads.b)
    ==
  ::
  ++  unread-threads
    |=  u=(map id-post:c id-reply:c)
    %-  pairs
    %+  turn  ~(tap by u)
    |=  [p=id-post:c r=id-reply:c]
    [+:(id p) (id r)]
  ::
  ++  pins
    |=  ps=(list nest:c)
    %-  pairs
    :~  pins/a/(turn ps nest)
    ==
  ::
  +|  %said
  ::
  ++  reference
    |=  =reference:c
    %+  frond  -.reference
    ?-    -.reference
        %post  (post post.reference)
        %reply
      %-  pairs
      :~  id-post+(id id-post.reference)
          reply+(reply reply.reference)
      ==
    ==
  ::
  ++  said
    |=  s=said:c
    ^-  json
    %-  pairs
    :~  nest/(nest p.s)
        reference/(reference q.s)
    ==
  --
::
++  dejs
  =,  dejs:format
  |%
  +|  %actions
  ::
  ++  a-channels
    ^-  $-(json a-channels:c)
    %-  of
    :~  create+create-channel
        pin+(ar nest)
        channel+(ot nest+nest action+a-channel ~)
        toggle-post+post-toggle
    ==
  ++  a-channel
    ^-  $-(json a-channel:c)
    %-  of
    :~  join+flag
        leave+ul
        read+ul
        read-at+(se %ud)
        watch+ul
        unwatch+ul
      ::
        post+a-post
        view+(su (perk %grid %list ~))
        sort+(su (perk %time %alpha %arranged ~))
        order+(mu (ar id))
        add-writers+add-sects
        del-writers+del-sects
    ==
  ::
  ++  a-post
    ^-  $-(json a-post:c)
    %-  of
    :~  add+essay
        edit+(ot id+id essay+essay ~)
        del+id
        reply+(ot id+id action+a-reply ~)
        add-react+(ot id+id ship+ship react+so ~)
        del-react+(ot id+id ship+ship ~)
    ==
  ::
  ++  a-reply
    ^-  $-(json a-reply:c)
    %-  of
    :~  add+memo
        del+id
        add-react+(ot id+id ship+ship react+so ~)
        del-react+(ot id+id ship+ship ~)
    ==
  ::
  +|  %primitives
  ++  id    (se %ud)
  ++  ship  `$-(json ship:z)`(su ship-rule)
  ++  kind  `$-(json kind:c)`(su han-rule)
  ++  flag  `$-(json flag:g)`(su flag-rule)
  ++  nest  `$-(json nest:c)`(su nest-rule)
  ++  ship-rule  ;~(pfix sig fed:ag)
  ++  han-rule   (sear (soft kind:c) sym)
  ++  flag-rule  ;~((glue fas) ship-rule sym)
  ++  nest-rule  ;~((glue fas) han-rule ship-rule sym)
  ::
  ++  create-channel
    ^-  $-(json create-channel:c)
    %-  ot
    :~  kind+kind
        name+(se %tas)
        group+flag
        title+so
        description+so
        readers+(as (se %tas))
        writers+(as (se %tas))
    ==
  ::
  ++  add-sects  (as (se %tas))
  ++  del-sects  (as so)
  ::
  ++  story  (ar verse)
  ++  essay
    ^-  $-(json essay:c)
    %+  cu
      |=  [=story:c =ship:z =time:z =kind-data:c]
      `essay:c`[[story ship time] kind-data]
    %-  ot
    :~  content/story
        author/ship
        sent/di
        kind-data/kind-data
    ==
  ::
  ++  kind-data
    ^-  $-(json kind-data:c)
    %-  of
    :~  diary+(ot title+so image+so ~)
        heap+(mu so)
        chat+chat-kind
    ==
  ::
  ++  chat-kind
    ^-  $-(json $@(~ [%notice ~]))
    |=  jon=json
    ?~  jon  ~
    ((of notice+ul ~) jon)
  ::
  ++  verse
    ^-  $-(json verse:c)
    %-  of
    :~  block/block
        inline/(ar inline)
    ==
  ::
  ++  block
    |=  j=json
    ^-  block:c
    %.  j
    %-  of
    :~  rule/ul
        cite/dejs:cite
        listing/listing
    ::
      :-  %code
      %-  ot
      :~  code/so
          lang/(se %tas)
      ==
    ::
      :-  %header
      %-  ot
      :~  tag/(su (perk %h1 %h2 %h3 %h4 %h5 %h6 ~))
          content/(ar inline)
      ==
    ::
      :-  %image
      %-  ot
      :~  src/so
          height/ni
          width/ni
          alt/so
      ==
    ==
  ::
  ++  listing
    |=  j=json
    ^-  listing:c
    %.  j
    %-  of
    :~
      item/(ar inline)
      :-  %list
      %-  ot
      :~  type/(su (perk %ordered %unordered %tasklist ~))
          items/(ar listing)
          contents/(ar inline)
      ==
    ==
  ::
  ++  inline
    |=  j=json
    ^-  inline:c
    ?:  ?=([%s *] j)  p.j
    =>  .(j `json`j)
    %.  j
    %-  of
    :~  italics/(ar inline)
        bold/(ar inline)
        strike/(ar inline)
        blockquote/(ar inline)
        ship/ship
        inline-code/so
        code/so
        tag/so
        break/ul
    ::
      :-  %block
      %-  ot
      :~  index/ni
          text/so
      ==
    ::
      :-  %link
      %-  ot
      :~  href/so
          content/so
      ==
    ==
  ::
  ++  memo
    %-  ot
    :~  content/story
        author/ship
        sent/di
    ==
  ::
  ++  pins
    %-  ot
    :~  pins/(ar nest)
    ==
  ::
  ++  post-toggle
    ^-  $-(json post-toggle:c)
    %-  of
    :~  hide/(se %ud)
        show/(se %ud)
    ==
  --
--
