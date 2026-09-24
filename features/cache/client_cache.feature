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
    And replaceable and addressable events always keep only the newest version (highest created_at; on a tie, lowest id per NIP-01)
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
    Then shelves, highlights, ratings, and What we are discussing appear from the landing snapshot before live relays answer
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
    When I publish a comment, rating, highlight, booklist or other list label, bookshelf directory, bookmark, bug report, or reading-queue (16374)
    Then the signed event is written to the client cache and session metadata as soon as it is signed
    And write relays are best-effort afterward (UI must not wait on them)
    And I can read that event from cache while relays are unreachable or I am offline
    And a later login-metadata refresh does not replace a newer locally signed kind 16374 with a stale relay copy

  Scenario: Reading now warms the cache
    Given I am signed in with tracked books in Reading now
    When those cards resolve on the home page
    Then their editions, current sections, and a stream window around pos are written to the client cache
    And Continue / reopen can paint that reading progress from cache while offline

  Scenario: Publication stream snapshots reopen without Mercury
    Given I have fully loaded a publication's section stream in this browser
    When I leave and reopen that edition (including a hard refresh)
    Then the reader paints a window of sections from a per-edition stream snapshot in Cache Storage
    And a complete snapshot does not re-run Mercury for first paint
    And an incomplete warm window still paints immediately while Mercury may refill in the background
    When I open Settings
    Then I see a human-readable cache size and a Clear Cache button
    When I press Clear Cache
    Then events and covers are emptied and appearance settings are not
    And listing full/compact/table density preference is also kept
    When the cache grows large
    Then older unused items may be evicted

  Scenario: Kind 5 deletions are swept after first paint
    When the app first loads
    Then first paint is not blocked
    And one batched kind 5 fetch then remembers deleted ids and a-tag addresses for the kinds this app uses
    And those kinds include 0, 3, 11, 20, 21, 1985, 9802, 10000, 10002, 10003, 10006, 10012, 10133, 10432, 1111, 16374, 30000, 30023, 30040, 30041, 30315, 30817, 30818, and 34259
    And matching events are evicted from the client cache and hidden from search and edition pages
    And when search or an edition page loads events, kind 5s targeting those ids and addresses are fetched and applied
    And the sweep does not flood the relay pool

  Scenario: Sign-in metadata is one batch
    When I complete sign-in
    Then one authors=me filter loads kinds 3, 10000, 10002, 10003, 10006, 10012, 10133, 10432, 1985, 30000, and 30315 from Mercury and the document stack
    And kind 16374 (reading queue) is loaded with a dedicated authors=me shelf query alongside bookmarks and directories, not crowded into the general limit:100 social batch
    And kind 0 is loaded separately from the profile relay stack, not Mercury
    And every valid event from that batch is written to the client cache
    And mute, relay lists, bookmarks, labels, payments, follow lists, and follow sets are not fetched one list at a time
