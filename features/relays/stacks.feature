@mvp
Feature: Centralized relay selection
  As a reader and writer
  I want one selector that picks relays, pools connections, and authenticates
  So that search, shelves, comments, and publish use the same policy

  Background:
    Given the shared third-party relays are wss://nostr.land, wss://nostr21.com, wss://relay.sovbit.host, and wss://nostr.wine
    And document/search defaults are wss://thecitadel.nostr1.com, wss://mercury-relay.imwald.eu, and those third-party relays
    And wiki defaults are the document/search relays plus wss://relay.wikifreedia.xyz
    And social/interaction defaults are wss://theforest.nostr1.com and those same third-party relays
    And catalog HTTP uses https://mercury-relay.imwald.eu
    And every read or write path asks one selector and reuses one pool
    And when I am signed in, relays that send AUTH are answered with NIP-42 once per connection
    And when I am not signed in, AUTH relays are not used

  Scenario: Anonymous reads use the matching default stack
    Given I am not signed in
    When I run a search for Nostr events
    Then reads go to the document/search defaults and Mercury HTTP
    And they do not use wss://theforest.nostr1.com as a document-only hop
    And they do not connect to relays known to require AUTH
    When a relay sends AUTH
    Then that relay is dropped until I sign in
    And NIP-42 is not attempted
    When I open a wiki or spec page
    Then reads add wss://relay.wikifreedia.xyz
    When I load comments, highlights, ratings, booklists, bookshelves, landing labels, or What we are discussing
    Then comments, highlights, ratings, booklists, and landing labels go to the social/interaction defaults
    And kind 30045 bookshelf directories go to the document/search defaults
    And they do not use the Citadel or Mercury WebSockets as the primary social store
    When the landing highlight list loads
    Then it unions the document/search and social/interaction stacks

  Scenario: The pool batches work
    When several searches run at once
    Then they share pooled connections
    And the site does not open a WebSocket per query
    And NIP-01 filters are batched
    And unresponsive or warning relays are backed off
    And healthy relays, Mercury HTTP, and cache still proceed

  Scenario: Signed-in extras and blocks
    Given I am signed in
    And I have kind 10002, 10012, and a reachable kind 10432 local relay
    When I read
    Then inbox, my own 10002 outboxes, favorite, and local relays are added to the matching stack
    And kind 10006 blocked relays are omitted
    When I publish a comment, rating, highlight, booklist or other list label, bookshelf directory, bookmark, or bug report
    Then writes go to my 10002 outboxes, 10012 favorites, and reachable 10432
    And writes are not sent to wss://aggr.nostr.land or wss://mercury-relay.imwald.eu

  Scenario: Local relays and nostr.land aggregator
    Given I am signed in
    And a kind 10432 local relay is not running
    When I read or write
    Then the selector tries it briefly and continues without waiting
    Given my 10002 or 10012 list contains wss://nostr.land
    When I read
    Then wss://aggr.nostr.land is included
    When I write
    Then it is not
    Given I am not signed in
    Then default wss://nostr.land does not add the aggregator
