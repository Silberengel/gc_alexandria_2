@mvp
Feature: Landing shelf rows and guide chips
  As a visitor or signed-in reader
  I want calm cover rows for bookshelves
  So that I can browse without a stack of per-folder shelves

  Background:
    Given cover rows use horizontal shelf bars
    And bookshelf / guide folder names use Guides-style guide-links chips
    And the From the guides chip list always renders (including Biblestr), even before relays answer
    And guide covers win over follows on overlap (mine is exclusive; follows and guides do not share covers)
    And GitCitadel Publishing memberships always paint From the guides, even when that pubkey is followed
    And there is no From the network landing shelf (stranger booklists are not shown as a home row)
    And extra guides cover tracks open only once each track can stay dense/scrollable (do not shred a thin resolve across empty rows)
    And shelf heading labels for own bookshelves and guides are not clickable

  Scenario: Signed-in Home shelves
    Given I am signed in with kind 30045 directories under my-book-collection
    When I open the home page
    Then I see one cover row titled "From your bookshelves" with covers from all my bookshelf folders
    And under that label I see my bookshelf names as guide-links chips
    And I see a cover row titled "From your follows' bookshelves" with follows' shelved publications minus my own
    And below that I see From the guides (one heading, one or more cover tracks)
    And under that guides label I see guide folder chips (and Biblestr)
    And those cover shelves stay together (Booklists does not sit between them)
    And if mine or follows has no covers, an extra guides cover track fills that slot under the same heading
    And I do not see From the network

  Scenario: Signed-out Home shelves
    Given I am not signed in
    When I open the home page
    Then I see From the guides once as a heading with three cover tracks
    And under that guides label I see guide folder chips (and Biblestr)
    And those cover shelves stay together (Booklists does not sit between them)
    And I do not see From the network
