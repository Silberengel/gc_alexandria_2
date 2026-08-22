@mvp
Feature: Routes
  As a visitor
  I want one set of paths
  So that every surface is reached the same way

  Scenario: App paths
    When I open one of:
      | path                         | result                                              |
      | /                            | landing                                             |
      | /search                      | global Nostr-event search results                   |
      | /p/{npub\|nprofile\|hex}     | profile                                             |
      | /publication/d/{d}           | disambiguation of matching top-level 30040 naddrs   |
      | /publication/d/{d}/p/{npub}  | that 30040                                          |
      | /publication/{naddr\|nevent} | that 30040; bar becomes /publication/d/{d}/p/{npub} |
      | /wiki/d/{d}                  | disambiguation of matching 30818 and 30817          |
      | /wiki/d/{d}/p/{npub}         | that wiki or spec page                              |
      | /wiki/{naddr\|nevent}        | that page; bar becomes /wiki/d/{d}/p/{npub}         |
      | /settings                    | appearance and cache                                |
      | /about                       | About                                               |
      | /start                       | Getting Started                                     |
      | /contact                     | Contact                                             |
    Then that is the path for that surface
