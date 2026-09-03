using System.Runtime.CompilerServices;

// The adapter's internals are the tests' subject: a clip group, an atlas, the
// vertex layout. Public would make them API; this keeps them what they are.
[assembly: InternalsVisibleTo("Zabloo.Sdk.Tests")]
