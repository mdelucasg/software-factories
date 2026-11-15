# Cadence

Cadence is a learning platform where Instructors create, publish, and manage video courses, and Students buy them (individually or through Team Licences), watch lessons, complete quizzes, join discussions, and request refunds.

## Language

### People

**Student**:
A person who takes courses on Cadence, either through an Individual Purchase or by claiming a Seat on a Team Licence.
_Avoid_: Learner, User

**Instructor**:
Speaks for their own courses only. An Instructor builds and edits the courses they own, and sees the Students enrolled on them.
_Avoid_: Teacher, Author, Creator

**Team Admin**:
A person who buys and manages a Team Licence. A Team Admin can raise a Refund Request for their Team Licence, but has no say in deciding it.
_Avoid_: Admin (on its own)

**Platform Admin**:
A member of Cadence staff who runs the platform. Only a Platform Admin decides Refund Requests.
_Avoid_: Admin (on its own), the team, Staff

### Courses

**Course**:
A structured collection of video lessons and quizzes created and managed by an Instructor. A Course is **Draft** (being built by the Instructor; not listed in the catalog or open for Purchase), **Published** (listed in the catalog and open for Purchase), or **Archived** (retired from the catalog and closed to new Purchases, while enrolled Students keep access).

**Enrollment**:
A Student's access to a Course, granted either by an Individual Purchase or by claiming a Seat on a Team Licence. An Enrollment is **Active** while the Student has access to the Course, or **Lapsed** when an approved Refund Request ends their access (while keeping their recorded progress).
_Avoid_: Subscription, Registration, Place on a course

### Purchases

**Purchase**:
A single payment for a Course. It is either an Individual Purchase or a Team Licence.
_Avoid_: Order, Transaction

**Buyer**:
The person who paid for a Purchase: a Student for an Individual Purchase, or a Team Admin for a Team Licence.

**Individual Purchase**:
A Purchase a Student makes for themselves. It grants that Student an Enrollment on the Course.

**Team Licence**:
A Purchase a Team Admin makes for others. It grants Seats, not an Enrollment for the Team Admin; the Team Admin can't watch the Course through it.
_Avoid_: Team purchase, Bulk purchase

**Seat**:
One claimable spot on a Team Licence that a Student can claim to get an Enrollment on the Course. A Seat is either **Unclaimed** (no Student has claimed it yet; frozen while a Refund Request is Open, and permanently unclaimable if approved) or **Claimed** (belongs to a Student; a Team Licence with any Claimed Seat can't be refunded).
_Avoid_: Coupon, Code, Voucher

### Refunds

**Refund Request**:
The Buyer's ask, with their reason, to get back what they paid for one specific Purchase. Only a Platform Admin can approve or decline it. One Purchase can have several Refund Requests over time, but only one can be undecided at once. A Refund Request is **Open** (awaiting a Platform Admin's decision; the Student keeps their Enrollment, and a Team Licence's Unclaimed Seats can't be claimed), **Approved** (decided by a Platform Admin; ends what the Purchase granted and leads to a Refund), or **Declined** (turned down by a Platform Admin; nothing the Purchase granted is lost, no Refund is issued, and the Buyer may raise a new Refund Request).
_Avoid_: Refund (for the ask itself), Cancellation, Reversal, Chargeback, Pending / Requested / Awaiting review (for Open)

**Refund**:
The money returned to the Buyer after a Platform Admin approves their Refund Request. It is always the full amount paid; a declined Refund Request has no Refund. A Refund is **Pending** (approved, money not yet confirmed as sent), **Issued** (money confirmed sent back to the Buyer), or **Failed** (money couldn't be sent; the Refund Request stays approved).
_Avoid_: Reversal, Chargeback, Cancellation, Completed / Paid out (for Issued)
