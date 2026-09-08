@mvp
Feature: Landing bookshelves
  As a visitor
  I want horizontal cover shelves of labeled, bookmarked, and shelved publications
  So that home feels like a library of people

  Background:
    Given shelf membership includes a kind 1985 NIP-32 label with any l value targeting a publication
    And that includes l=booklist (namespace ugc) and custom or home-genre labels such as adventure
    And bookmarked means a kind 10003 NIP-51 a-tag or e-tag targeting a publication
    And shelved means a kind 30045 directory a-tag or e-tag targeting a publication
    And all of those count as shelf membership for the priority rows
    And the GitCitadel curator is npub18cddpua960qjy3wmw7y9gmzr4h3ajlrwq3k9jnmqzlxke4qkg6gqeyaztw
    And shelf order after dedup is mine, then follows, then GitCitadel, then the rest of the social read stack
    And signed-in nested 30045 folders (not my-book-collection) appear as extra horizontal rows after those
    And 1985 and 10003 membership uses the social/interaction stack
    And 30045 membership uses the document/search stack
    And each shelf is a horizontal row of covers or cover placeholders, not metadata cards
    And each shelf has its own horizontal shelf-bar and scrolls by itself
    And covers use the publication's image tag when present, else a cover placeholder
    And a cover placeholder shows Title (else human T, else human d) and Author (else human N)
    And a cover shows a book-icon badge at the bottom-right when that publication's index has at least one e-tag or a non-30040 a-tag (nested 30040s alone do not count)
    And covers load when they enter view
    And publications on a shelf are ranked newest first
    And when a shelf has fewer than 10 publications I see all of them
    And when a shelf has at least 10 publications I see the 3 newest first and the remaining covers shuffled from the current UNIX timestamp
    And empty shelves are omitted
    And a home with no shelves or only one shelf is still the landing page
    And clicking a cover opens that edition's interactive /publication/d/{d}/p/{npub} page (header and social lists), not the in-browser reader

  Scenario: Only non-empty shelves are shown
    Given I am not signed in
    When I open the home page
    Then I see every non-empty shelf in priority order
    And I do not see a mine or follows shelf
    And I do not see an empty GitCitadel or network shelf
    When every shelf is empty
    Then I still see the global search bar
    And I see no shelf rows

  Scenario: Shelves refresh when identity changes
    Given I was signed in as Alice and My shelf showed her books
    When I sign out
    Then My shelf and Follows disappear immediately
    And label chips from the previous identity are cleared until the next landing load finishes
    And a cached Alice snapshot is not reused as anonymous shelves
    When I sign in as Bob
    Then shelves reload for Bob
    And Alice's My shelf does not linger while Bob's landing loads
    And sign-in does not fire overlapping full landing refreshes that rate-limit relays
    And My shelf is built from Bob's login metadata rather than rescanning every social relay for all of Bob's bookmarks
    And follows, GitCitadel, and network shelves still sample others' 1985, 10003, and 30045 membership from the social and document stacks

  Scenario: Signed-in shelves follow the priority order
    Given I am signed in with a kind 3 follow list or kind 30000 follow sets
    And publication A is booklisted by me
    And publication B is booklisted by a follow and not by me
    And publication C is booklisted only by the GitCitadel curator
    And publication D is booklisted only by someone else on my inbox or favorite relays
    And publication E is booklisted by me, a follow, the curator, and someone on my inbox relays
    When I open the home page
    Then A and E appear only on my shelf
    And B appears only on the follows shelf
    And C appears only on the GitCitadel shelf
    And D can appear on the remaining shelf
    And a refresh always re-queries the curator pubkey's kind 1985 labels on the social stack so new GitCitadel labels appear without waiting on a stale Mercury sample

  Scenario: Follows shelf uses follow list and follow sets
    Given I am signed in
    And my kind 3 follow list and kind 30000 follow sets are in cache from login
    When I open the home page
    Then the follows shelf unions pubkeys from both
    And I cannot follow or unfollow from this app
    Given no follow list and no follow set is available
    When I open the home page
    Then I do not see a follows shelf

  Scenario: Recency is the reference event
    Given publication New was booklisted yesterday
    And publication Old was published last year but booklisted today
    And both qualify for the same shelf
    When I open the home page
    Then Old appears before New on that shelf

  Scenario: Signed-in user can add and remove list labels
    Given I am signed in
    When I add a work to my booklist or a home-genre or custom list from an edition page
    Then a kind 1985 ugc label is published targeting that publication
    And it appears on my home shelf after reload
    When I remove it
    Then that 1985 is deleted or no longer targets that publication
    And my other labels are left intact
    And it no longer appears on my shelf for that reason

  Scenario: Signed-in user can add and remove one bookmark
    Given I am signed in
    And I already have other items on my kind 10003
    When I bookmark a work from an edition page
    Then my kind 10003 is published with that publication's a-tag or e-tag added
    And every other bookmark entry is preserved
    When I remove that bookmark
    Then that one entry is gone
    And the rest of the list remains
    And the whole 10003 is not replaced by a single-item list
