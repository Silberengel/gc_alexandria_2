@mvp @performance
Feature: Nostr stays in the background
  As a reader who does not know what a relay is
  I want the site to feel like a normal library
  So that I can search and read without protocol ceremony

  Scenario: Failures are library language
    Given all document relays are unreachable
    And the index catalog is available
    When I browse and search
    Then I still see canonical results
    And I do not see REQ, EOSE, kind, or relay in primary UI copy
    And a dead Mercury, DNS failure, or any single relay timeout never crashes or blanks the client

  Scenario: Protocol details are opt-in
    When I open an edition page
    Then I can expand a Details control
    And I can see the event id, coordinate, and where it was found
    And where it was found lists the relay URLs that returned it
    And the library index appears as wss://mercury-relay.imwald.eu when Mercury HTTP found it
