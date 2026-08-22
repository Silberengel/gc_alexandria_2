@mvp
Feature: Mute list
  As a signed-in reader
  I want people I muted never to show up
  So that feeds and threads stay mine

  Background:
    Given my mute list is kind 10000
    And muted pubkeys are its p tags, including private tags when they can be decrypted
    And muted events are its e tags when present

  Scenario: Mute drops authors everywhere
    Given I am signed in
    And pubkey Muted is on my mute list
    When any surface loads
    Then no event authored by Muted is shown: search, shelves, cards, highlights, discussing, labels, subjects, profile produced and interacted-with lists, wiki version lists, threads, ratings, reader, and userbadges
    And they do not occupy a slot
    Given I am not signed in
    Then events are not hidden for mute

  Scenario: Missing or muted parents use the same placeholder
    Given a kind 1111 reply whose parent is muted or cannot be found
    When I see that reply
    Then I see "This npub is muted or the event could not be found."
    And the reply is still shown under that placeholder
    And the UI does not say whether the parent was muted or only missing

  Scenario: Mute list load does not block the page
    Given I am signed in
    When a page opens
    Then content can appear before the mute list arrives
    And muted authors are then removed without a full reload

  Scenario: Mute list is read-only in the app
    Given I am signed in
    Then my kind 10000 is applied from the login metadata cache
    And I cannot add or remove mutes in this app
