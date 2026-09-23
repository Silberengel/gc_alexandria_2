@mvp
Feature: Identity
  As a visitor
  I want to browse anonymously and optionally sign in
  So that reading is frictionless and publishes are mine

  Scenario: Anonymous browse
    When I use the site without signing in
    Then I can search, open editions, read, and read wiki pages
    And I am asked to sign in when an action needs a signer
    And those actions include rate, comment, highlight, booklist and other list labels, bookshelf, bookmark, and contact publish

  Scenario: Sign in without pasting an nsec
    Given a NIP-07 extension, Amber / NostrConnect, a bunker:// URI, or Pomegranate is available
    When I complete sign-in from the Sign in dialog
    Then the site shows that I am signed in with that pubkey's userbadge
    And I do not paste an nsec into the page
    And Amber opens via nostrconnect:// or a pasted bunker:// link
    And Pomegranate uses Google at the coordinator then a secret-less bunker:// to that coordinator

  Scenario: Sign out
    Given I am signed in
    When I sign out
    Then I am back to anonymous browse

  Scenario: Refresh keeps NIP-07 or bunker session
    Given a NIP-07 extension is available and I am signed in
    When I reload the page
    Then the site restores that pubkey from this browser's local storage and confirms via getPublicKey when the extension is ready
    And I do not paste an nsec into the page
    And My shelf can rebuild from login metadata without waiting minutes on per-address relay fetches
    When I signed in with Amber or bunker
    Then reload restores the sanitized bunker:// URL and client secret from local storage
    And Track reading / progress publishes wake the bunker relays and open Amber for approval when needed
    And a backgrounded Amber approval does not start a second overlapping sign request
    When I sign out
    Then the persisted session is cleared and reload stays anonymous
