@mvp
Feature: Sanitize and verify
  As a visitor
  I want every string and event checked before it is stored or shown
  So that markup and bad events cannot break the page

  Scenario: Strings are sanitized
    When I see markup, URLs, search terms, profile JSON, or payment URIs
    Then scripts and event handlers are not executed
    And Djot, Markdown, and AsciiDoc are sanitized after render
    And javascript: and other non-http(s) schemes are not used as links or media
    And a nostr: prefix before a valid bech32 npub, nprofile, naddr, nevent, or note is rendered as in generic_card, not as a raw URL
    And nostr:nsec and invalid bech32 are not links
    And search terms are treated as a literal query
    And invalid kind 0 JSON is ignored
    And only recognized payto or lightning authorities are offered as actions

  Scenario: Events are verified on ingest and before render
    When an event arrives from Mercury, a relay, or cache
    Then it is dropped unless it is a valid signed NIP-01 event
    And it is not written to cache if invalid
    And an invalid event is omitted or shown as a placeholder
    And the rest of the page still renders
