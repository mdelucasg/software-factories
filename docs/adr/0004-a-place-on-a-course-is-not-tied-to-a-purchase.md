# A Student's Enrollment on a Course is not tied to the Purchase that granted it

A Student has one Enrollment per Course, whether it came from an Individual Purchase or a Claimed Seat, and the Enrollment doesn't record which. A Refund Request, by contrast, belongs to one specific Purchase. So approving a refund on an Individual Purchase must check whether the Student also holds a Claimed Seat for that Course, and leave their Enrollment alone if they do.

## Consequences

The code used to attach a Refund Request to the Buyer's newest Purchase of the Course. A Student who bought for themselves and then bought a Team Licence would have refunded the wrong one. The Buyer now chooses the Purchase: Individual Purchases from the course page, Team Licences from the team page.
