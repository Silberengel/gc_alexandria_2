@mvp
Feature: Broken addresses and empty results
  As a visitor
  I want a clear error page when a path is bad or an event is missing
  So that I am not left with a blank screen or protocol text

  Scenario: Invalid, unknown, and missing
    When I open a malformed address, an unknown path, or a well-formed /publication/, /wiki/, or /p/ whose event cannot be found
    Then I see the error page
    And I am not shown a blank page or raw protocol text
    When I open /publication/{nevent} of a 30041 or other non-30040
    Then I see the error page
    When /publication/d/{d} has only nested 30040s and no top-level match
    Then I see the error page
    When a wikilink target does not exist
    Then I see the error page for that slug
    When I follow a card, ToC, or nostr: embed to a missing or invalid event
    Then I see the error page

  Scenario: Unreadable text stays on the interactive edition page
    When index meta reports an edition is not readable
    Then I still see the edition header and interaction lists
    And I do not see a "Read the publication" button
    And I do not see an empty reader or raw protocol text
    When Read cannot load a Mercury tree or a document-stack fallback
    Then I see the unreadable-edition error page

  Scenario: Empty search
    When a search has no matching cards after mute and verify
    Then I see that nothing matched
