@mvp
Feature: Top bar and search
  As a visitor on any current browser
  I want a site header and a global search for Nostr events
  So that I can look up events without a Chrome-only UI

  Background:
    Given the site runs in current Firefox, Safari, and Chromium browsers
    And the top bar follows the gc-alexandria header: brand, navigation, and sign-in
    And the global search bar stays in the top bar on every page and looks up Nostr events (bech32, hex, tags, and fan-out)
    And other pages may filter text already on that page

  Scenario: Top bar is on every page
    When I open any page
    Then I see an Alexandria Library logo that opens /
    And I can open /about and /settings from the top bar
    And when I am signed in I can also open /contact from the top bar
    And when I am not signed in Contact is omitted from the top bar
    And I see sign-in or my signed-in userbadge
    And I do not see compose, events, or visualize controls
    And on a narrow screen the brand and session share the first row while nav sits on the row below
    And on a narrow screen the signed-in badge shows the profile picture without the display name
    And on a very wide screen the top bar is one row: brand, tabs, search, then session

  Scenario: Top bar auto-hides in the publication reader
    When I am reading a publication
    And I scroll down
    Then the top bar hides so the floating ToC control is the only site navigation
    When I scroll up
    Then the top bar is shown again
    And when I leave the reader the top bar stays visible again

  Scenario: Global Nostr search stays in the top bar
    When I am on /, /search, an edition, a wiki page, /p/, or a project page
    Then I see the global search bar in the top bar
    And I can type into the global search bar and search Nostr events with typeahead
    And /search, edition, wiki, and profile pages have a filter for text on that page only
    And that page filter does not look up new Nostr events on relays or Mercury
    And on the reader and a wiki article the filter jumps to the match and highlights it
    And Enter moves to the next highlighted match
