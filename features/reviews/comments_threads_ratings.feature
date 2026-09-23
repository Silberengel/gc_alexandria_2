@mvp
Feature: Comments, threads, and ratings
  As a reader
  I want comment threads on an edition or wiki, and star ratings on an edition
  So that the page behaves like a book page

  Scenario: Edition threads nest replies
    Given an edition has a kind 1111 comment targeted at that 30040, with a reply
    And kind 1 notes that e-tag the edition or a comment in the thread are shown too
    When I open that edition
    Then I see the root and its reply nested on the edition page before Read
    And I see each commenter's userbadge
    And each comment shows a relative created-at time (with the absolute time on hover)
    And kind 1 replies nest under their parent e-tag (or as roots when that e-tag is the edition)
    And each kind 1 or kind 1111 response has a heart button that shows the count of kind 7 "+" likes (rendered as the jumble heart emoji)

  Scenario: Section comments sit behind a more menu
    When I am reading a section
    Then the bottom of that section has a more menu with highlight, copy pointer, njump.me, jumble.imwald.eu, and comment actions
    And there is no horizontal rule above those controls
    When I open Comments from that menu
    Then I see kind 1111 comments targeted at that section
    And kind 1 replies that e-tag that section or those comments
    And when I am signed in I can compose a new root comment on that section

  Scenario: Comments stay scoped
    Given I am signed in
    When I comment or reply on an edition, section, or wiki
    Then a kind 1111 NIP-22 event is targeted at that item
    And it does not appear on an unrelated work
    When I reply to a kind 1 note
    Then that reply is a kind 1 NIP-10 note with root and reply e-tags
    When I reply to a kind 1111 comment or a kind 9802 highlight
    Then that reply is a kind 1111 NIP-22 comment
    When I reply to a kind 34259 rating
    Then that reply is a kind 1111 NIP-22 comment targeted at that rating
    When I like a rating, highlight, kind 1 note, or kind 1111 comment
    Then a kind 7 reaction with content "+" is published (shown as a heart with a count)
    And liking again removes my reaction with a kind 5 deletion
    And I cannot like my own events (heart button disabled)
    And when I am signed out the heart and reply buttons are disabled

  Scenario: Ratings use kind 34259 on an edition
    Given ratings are kind 34259 events with m=book, books, novel, or publication whose d and a/A tags are 30040:<pubkey>:<d-tag>
    And the rating tag is stars/5 in (0, 1] with an s tag for whole stars 1–5
    And optional review text lives in the rating content with c=true
    And wikis are not rated
    And an edition has kind 34259 ratings
    When I open that edition
    Then I see an aggregate on a 1-to-5 star scale with star icons and each scored rater's userbadge and stars
    And unscored 34259 events without a valid rating tag do not change the average
    When I am signed in and submit a rating
    Then it references that edition with jumble-compatible tags
    And my previous rating of the same d-tag is replaced
    And a rating of another edition of the same i-tag is a different rating
    And kind 1111 remains the comment thread, separate from the rating form
    And each listed rating has a heart button and a reply control for kind 1111 replies
    And when I already have a published rating the form is closed until I click the edit control on my review
    And a liked heart is filled red; an unliked heart is a line icon with a normal-weight count
    When I clear the rating form
    Then my stars and review text in the form are cleared
    And no kind 5 deletion is published
    And any preexisting rating of mine stays listed
    When I cancel editing an existing rating
    Then the form closes and my published review stays listed unchanged
