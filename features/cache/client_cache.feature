@mvp
Feature: Client event cache
  As a visitor
  I want events and covers I already downloaded, and events I just published, to be reused
  So that moving around the library, or going offline, does not require a live relay

  Background:
    Given the site has no server database for this cache
    And verified events and cover images are kept in the browser's persistent cache
    And that cache is HTTP cache and Cache Storage, not an IndexedDB event database

  Scenario: Revisits use the cache
    Given I have loaded a publication's header, social lists, sections, and a cover
    When I leave and return in this browser, including while offline
    Then those ids and covers are served from cache
    And replaceable events may still refresh if a newer version exists
    When I open a landing shelf cover whose edition is in the landing snapshot
    Then the edition page paints from cache even if Mercury or relays fail
    And relay queries stay limited so NOTICE "too many concurrent REQs" is less likely
    And browser clients always skip Tor (.onion) and I2P (.i2p) relays and cap how many relays each query fans out to
    When I click a cover or card for an edition already shown on home or search
    Then the edition header metadata appears immediately from that known event
    And opening it does not re-query relays just to render that same 30040

  Scenario: Landing paints from a snapshot
    Given I have opened the home page before in this browser
    When I open it again
    Then shelves, highlights, and What we are discussing appear from the landing snapshot before live relays answer
    And live results replace that snapshot when they arrive
    And if live relays or Mercury return nothing the snapshot stays on screen
    And the snapshot is tagged with the viewer pubkey or null when anonymous
    When I open home signed out after browsing signed in as Alice
    Then Alice's My shelf and Follows are not shown from her snapshot

  Scenario: Repeat search paints from a snapshot
    Given I have searched for a term, subject, or label in this browser
    When I search that same value again
    Then last result cards appear before live API and relays answer
    And live results replace that snapshot when they arrive
    And if live API and relays return nothing the snapshot stays on screen

  Scenario: Local publishes are written to cache
    When I publish a comment, rating, highlight, booklist or other list label, bookshelf directory, bookmark, or bug report
    Then the signed event is written to the client cache as it is sent to write relays
    And I can read that event from cache while relays are unreachable or I am offline

  Scenario: Cache is bounded and clearable
    When I open Settings
    Then I see a human-readable cache size and a Clear Cache button
    When I press Clear Cache
    Then events and covers are emptied and appearance settings are not
    When the cache grows large
    Then older unused items may be evicted

  Scenario: Kind 5 deletions are swept after first paint
    When the app first loads
    Then first paint is not blocked
    And one batched kind 5 fetch then evicts deleted ids for the kinds this app uses
    And those kinds include 0, 3, 11, 20, 21, 1985, 9802, 10000, 10002, 10003, 10006, 10012, 10133, 10432, 1111, 30000, 30023, 30040, 30041, 30315, 30817, 30818, and 34259
    And the sweep does not flood the relay pool

  Scenario: Sign-in metadata is one batch
    When I complete sign-in
    Then one authors=me filter loads kinds 0, 3, 10000, 10002, 10003, 10006, 10012, 10133, 10432, 1985, 30000, and 30315
    And every valid event from that batch is written to the client cache
    And mute, relay lists, bookmarks, labels, payments, follow lists, and follow sets are not fetched one list at a time
