@mvp
Feature: Profile page
  As a visitor
  I want a page for an npub
  So that badges open a person, not a search dump

  Background:
    Given /p/{npub}, /p/{nprofile}, and /p/{hex-pubkey} open the same profile
    And kind 0 is fetched from profile relays (profiles.nostr1.com, indexer.coracle.social, thecitadel.nostr1.com), never from Mercury
    And when signed in those queries also include my inbox, outbox, favorites, and local relays
    And kind 0 fields come from tags first, then JSON content, then are deduped
    And display_name is the heading when present; otherwise name
    And picture and display name render once (no duplicate userbadge under the header)
    And website and nip05 tags are listed (all values), not only the first
    And each NIP-05 is verified against that domain's /.well-known/nostr.json
    And a green checkmark is shown when the address maps to this profile's pubkey
    And remaining non-standard tags and extra JSON keys still appear (not published_at)
    And NIP-38 user status is kind 30315 with d-tag general or music (as in jumble)
    And payment targets merge kind 0 lud16, lud06, payto (type+authority), wallet-shaped w tags, and kind 10133, as in jumble and Imwald
    And payment rows are deduped by canonical type plus authority
    And empty produced and interacted-with lists are omitted

  Scenario: Userbadges open /p/
    When I see a published-by, comment, highlight, rating, or signed-in badge
    Then it is a userbadge using that pubkey's kind 0 picture and display name when they exist
    And if there is no picture I see a generic avatar on that userbadge
    And clicking it opens /p/ for that npub
    And a nostr: npub or nprofile in content is the compact userbadge in generic_card, with no picture
    And clicking that compact badge also opens /p/

  Scenario: /p/ lists profile, status, and payments
    When I open /p/ for a pubkey that has a kind 0
    Then I see a 16:5 banner when present (or a theme-tinted pubkey fallback when missing), an unskewed circular picture, and the title once
    And the title is display_name when set, otherwise name
    And I see about, websites, NIP-05 values, and other tags when present
    And #hashtags in about link to subject search (#/search?subject=)
    And a GrapeRank badge shows their trusted-assertion score when known
    And when I am signed in and follow them, a Following badge is shown (not on my own profile)
    And a field in both tags and JSON is shown once, with the tag winning
    And extra JSON keys still appear (not displayName aliases)
    And unexpired kind 30315 general and music statuses are shown under the display name with icons and an r-tag https link when present
    And those statuses are loaded from profile mirrors and the social stack
    And payment targets from kind 0 then kind 10133 are shown once per type plus authority
    When that pubkey has no kind 0
    Then I still see the pubkey and omit missing fields

  Scenario: /p/ lists what they produced and touched
    Given that pubkey signed a 30040, 30818, or 30817
    And another such event credits them with a p-tag
    And they have labeled, bookmarked, highlighted, or commented on a publication or wiki, or rated a publication
    When I open /p/ for that pubkey
    Then the produced list includes the signed and p-tagged events
    And nested 30040 subindexes are omitted when they also have a top-level 30040
    And the interacted-with list shows those publications and wikis marked labeled, shelved, bookmarked, highlighted, or commented-on, and publications marked rated
    And a section or subindex interaction is shown as the parent publication when known
    And a work can appear in both lists
    And this is not a literary author-name catalog
