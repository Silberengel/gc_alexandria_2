@mvp
Feature: Top bar and search
  As a visitor on any current browser
  I want a site header and a global search for Nostr events
  So that I can look up events without a Chrome-only UI

  Background:
    Given the site runs in current Firefox, Safari, and Chromium browsers
    And the top bar follows the gc-alexandria header: brand, navigation, and sign-in
    And the global search bar on / looks up Nostr events (bech32, hex, tags, and fan-out)
    And other pages may filter text already on that page

  Scenario: Top bar is on every page
    When I open any page
    Then I see an Alexandria Library logo that opens /
    And I can open /about, /contact, and /settings from the top bar
    And I see sign-in or my signed-in userbadge
    And I do not see compose, events, or visualize controls

  Scenario: Global Nostr search is on the landing page
    When I am on /
    Then I can type into the global search bar and search Nostr events with typeahead
    When I am on /search, an edition, a wiki page, /p/, or a project page
    Then I do not see that global search bar
    And /search, edition, wiki, and profile pages have a filter for text on that page only
    And that page filter does not look up new Nostr events on relays or Mercury
