@mvp
Feature: Thread follow, notification mute, and hide event
  As a signed-in reader
  I want to follow or mute threads and hide events
  So that Notifications and feeds stay useful

  Background:
    Given thread follow is kind 19130 with e or a tags
    And thread notification mute is kind 19132 with e or a tags
    And hide event uses kind 10000 e tags (optional a for addressables, optional p for author)

  Scenario: Follow this thread is for other people's events
    Given I am signed in
    When I open the more menu on someone else's event
    Then I can Follow this thread
    And following stores that event's e or a on kind 19130
    And descendants under that event can appear in Notifications without a #p tag
    When I open the more menu on my own event
    Then Follow this thread is not offered
    And my own threads still notify me without a 19130 row

  Scenario: Mute this thread works on own and others
    Given I am signed in
    When I Mute this thread on my event or someone else's
    Then that event's e or a is on kind 19132
    And matching interactions leave Notifications
    And the thread remains visible in the reader and feeds

  Scenario: Hide this event offers author mute
    Given I am signed in
    When I Hide this event on someone else's event
    Then I am asked whether to also mute the author
    And kind 10000 gains an e tag for the event
    And when I choose to mute the author a p tag is added too
    And the event is scrubbed from the local cache
    And muting the author scrubs their cached events

  Scenario: Follow is exclusive with hide and notification mute
    Given I am signed in
    And an event is already followed on 19130
    When I choose Mute this thread or Hide this event
    Then I am warned that the event will move out of followed threads
    And after I confirm only the new membership remains
    Given an event is hidden on 10000 or muted on 19132
    When I choose Follow this thread
    Then I am warned and confirming unhides or unmute-notifies and follows

  Scenario: Conflicting wire lists prefer hide and notif-mute over follow
    Given my lists already contain the same event on 19130 and 19132 or 10000
    When Notifications and menus resolve effective state
    Then hide and 19132 win over follow without an automatic republish
    And the next confirmed toggle heals the losing membership
