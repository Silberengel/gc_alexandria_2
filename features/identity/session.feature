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
    Given a NIP-07 extension or a NIP-46 remote signer is available
    When I complete sign-in
    Then the site shows that I am signed in with that pubkey's userbadge
    And I do not paste an nsec into the page

  Scenario: Sign out
    Given I am signed in
    When I sign out
    Then I am back to anonymous browse
