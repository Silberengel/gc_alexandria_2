@mvp
Feature: About and Contact
  As a visitor
  I want the same project pages as on the current Alexandria site
  So that I can learn the library, find GitCitadel, and send a bug report

  Scenario: About includes getting started
    When I open /about
    Then I see that this is the Library of Alexandria, a GitCitadel project
    And I can follow GitHub, Geyser, gitcitadel.com, and the GitCitadel Nostr profile
    And I see the app version when a release version is known
    And I see how to search, open an edition, read, and open a wiki page

  Scenario: Contact matches the current Alexandria contact page
    When I open /contact
    Then I see "Contact GitCitadel"
    And I can follow GitHub at github.com/ShadowySupercode/gitcitadel and Geyser at geyser.fund/project/gitcitadel
    And I see the GitCitadel userbadge for npub1s3ht77dq4zqnya8vjun5jp3p44pr794ru36d0ltxu65chljw8xjqd975wz
    And I can open gitworkshop.dev/silberengel@gitcitadel.com/Alexandria/issues
    And I see a subject-and-body issue form
    Given I am not signed in
    When I submit the form
    Then I am asked to sign in and the draft is kept
    Given I am signed in
    When I submit a subject and body
    Then a kind 1621 issue is published
    And its a-tag is 30617:fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1:Alexandria
    And a p-tag names that repo owner
    And I see confirmation and a link to the issue
    When I submit without a subject or body
    Then I see a validation error and no issue is published
