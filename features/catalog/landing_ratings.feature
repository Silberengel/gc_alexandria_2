@mvp
Feature: Landing publication ratings
  As a visitor
  I want recent book ratings on the home page
  So that I can see what people are reviewing before highlights and comments

  Background:
    Given ratings are kind 34259 events with m=book (or books/novel/publication) targeting a 30040 a-tag
    And only scored ratings (valid rating tag) appear
    And this list reads the social/interaction stack and Mercury when available
    And live hits merge Mercury, relay, and client-cache ratings
    And the landing page shows at most 10 ratings
    And ratings sit below the publication shelves and above Highlights / What we are discussing

  Scenario: One newest rating per edition
    Given edition G has an older rating and a newer rating
    When I open the home page
    Then each entry is a different edition
    And G shows only the newer rating
    And entries are ordered by that newest rating's created_at

  Scenario: A row is usable
    When I open the home page and ratings are present
    Then the publication title is the link
    And the rater's userbadge, star score, and optional review excerpt sit in a review card
    And ratings use a responsive grid up to three cards wide
    And a View review control opens that edition with ?rating={id} and scrolls to that review
    And clicking the title opens that edition's /publication/d/{d}/p/{npub} at the top (without focusing the rating)
    And highlights and discussing rows use the same title-vs-View pattern
    And the landing page does not show reaction or reply controls on ratings
