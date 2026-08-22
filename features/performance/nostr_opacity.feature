@mvp @performance
Feature: Nostr stays in the background
  As a reader who does not know what a relay is
  I want the site to feel like a normal library
  So that I can search and read without protocol ceremony

  Scenario: Home is usable with WebSockets blocked
    When I open the home page with WebSockets blocked
    Then I see a catalog within 1 second
    And I can open an edition and begin reading a canonical copy
    And landing shelves, highlights, discussing, subject buttons, and label buttons may fill in later
    And events already in cache remain readable if the network is gone

  Scenario: Failures are library language
    Given all document relays are unreachable
    And the index catalog is available
    When I browse and search
    Then I still see canonical results
    And I do not see REQ, EOSE, kind, or relay in primary UI copy

  Scenario: Protocol details are opt-in
    When I open an edition page
    Then I can expand a Details control
    And I can see the event id, coordinate, and where it was found
