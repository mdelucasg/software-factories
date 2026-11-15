# An Enrollment ends when the Refund Request is approved

The Student keeps their Enrollment on the Course while their Refund Request is Open and loses it the moment a Platform Admin approves it, not when the Refund is issued.

## Considered Options

- **When the request is raised**: rejected, because a Student whose request is declined would have been locked out for nothing.
- **When the Refund is issued**: rejected, because a Failed Refund would leave the Student holding both the Enrollment and an approved Refund Request, and it would tie the Course to money movement that is handled separately.
