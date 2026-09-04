using System.Runtime.CompilerServices;

// The receiver's pure half (`DevPush`) is the tests' subject. Public would make
// it API of an editor assembly nobody references; this keeps it what it is.
[assembly: InternalsVisibleTo("Zabloo.Sdk.EditorTests")]
