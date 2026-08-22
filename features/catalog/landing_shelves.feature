@mvp
Feature: Landing bookshelves
  As a visitor
  I want horizontal cover shelves of booklisted and bookmarked publications
  So that home feels like a library of people

  Background:
    Given booklisted means a kind 1985 NIP-32 label with l=booklist (namespace ugc) targeting a publication
    And bookmarked means a kind 10003 NIP-51 a-tag or e-tag targeting a publication
    And both count as shelf membership
    And the GitCitadel curator is npub18cddpua960qjy3wmw7y9gmzr4h3ajlrwq3k9jnmqzlxke4qkg6gqeyaztw
    And shelf order after dedup is mine, then follows, then GitCitadel, then the rest of the social read stack
    And each shelf is a horizontal row of covers or cover placeholders, not metadata cards
    And each shelf has its own horizontal shelf-bar and scrolls by itself
    And covers use the publication's image tag when present, else a cover placeholder
    And covers load when they enter view
    And publications on a shelf are ordered newest bookmark or booklist reference first
    And below the shelves, informative cards list those same publications
    And empty shelves are omitted
    And clicking a cover or card opens that edition's /publication/d/{d}/p/{npub}

  Scenario: Only non-empty shelves are shown
    Given I am not signed in
    When I open the home page
    Then I see every non-empty shelf in priority order
    And I do not see a mine or follows shelf
    And I do not see an empty GitCitadel or network shelf
    When every shelf is empty
    Then I still see the global search bar
    And I see no shelf rows

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

  Scenario: Signed-in user can add and remove a booklist label
    Given I am signed in
    When I add a work to my booklist from an edition page
    Then a kind 1985 booklist label is published targeting that publication
    And it appears on my home shelf after reload
    When I remove it
    Then that 1985 is deleted or no longer targets that publication
    And my other booklist labels are left intact
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
