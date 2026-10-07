# C# Style

Substitute the project's own names for the `Acme` examples. Inside a repo already in this style, follow a sibling file's layout exactly.

## 1. File Structure

Order usings `System.*` first, then third-party where convenient (Serilog often mid-list), then project namespaces, then other third-party such as `AutoMapper` and `MediatR`. Order inside a group is loosely alphabetical. Put no blank lines between groups, and one blank line before the namespace.

Keep namespaces coarse. Plugin assemblies declare none. A warranted namespace aligns to a plugin or large functional chunk, typically one root per project. Folders never generate sub-namespaces such as `Acme.Documents.Services`.

Where a new file declares a namespace, make it file-scoped:
```csharp
namespace Acme.Documents;
```

Leave existing block-scoped files, such as `Assembly/RegisterServices.cs`, alone.

Interfaces live in `Interfaces/`, never beside their implementations.

## 2. Region Order

Organize a class into `#region` blocks in this order:

1. `#region Constants` - `private const string` declarations, omitted if none
2. `#region Variables` - private fields under `// Group.` labels
3. `#region Constructor` - the single constructor
4. Public method-group regions named for what they do, such as `#region Form Processing`
5. `#region Private Methods` - last, optionally with nested regions for sub-themes

Close every region with a matching `#endregion`. Align both lines with the region's contents (four spaces inside a class), not the class brace.

Skeleton:
```csharp
public class FormService : IFormService
{
    #region Constants
    private const string downloadUrlSuffix = ".download_url";
    private const string signatureUrlSuffix = ".signature_url";
    #endregion

    #region Variables
    // Values.
    private static StringComparison IgnoreCase => StringComparison.InvariantCultureIgnoreCase;

    // Mapper.
    private readonly Mapper _mapperService;

    // Services.
    private readonly IApiService _apiService;
    private readonly IHtmlService _htmlService;
    #endregion

    #region Constructor
    public FormService(
            IApiService apiService,
            IHtmlService htmlService
    )
    {
        // Save Services.
        _apiService = apiService;
        _htmlService = htmlService;
    }
    #endregion

    #region Form Processing
    public async Task<FilledForm?> ProcessFormAsync(
        FilledDocument document,
        CancellationToken cancellationToken
    )
    {
        // ...
    }
    #endregion

    #region Private Methods

        #region Form Handling
        private async Task<FilledForm?> CreateFilledFormAsync(...) { ... }
        #endregion

        #region Field Handling
        private Task<Dictionary<string, string>> ExtractFieldsAsync(...) { ... }
        #endregion

    #endregion
}
```

## 3. Field Naming and Grouping

- Private fields are `_camelCase`.
- Injected dependencies are `readonly`.
- `private const` names are `camelCase` for local strings (`downloadUrlSuffix`) and `SCREAMING_SNAKE_CASE` for cross-cutting markers (`EMAIL_SENT`).
- Static computed comparison properties are PascalCase: `IgnoreCase`.

In `#region Variables`, group fields under single-line `// Group.` labels, a blank line between groups. Common labels: `// Values.` for static comparers and computed defaults, `// Mapper.` for AutoMapper, `// Services.` for injected services, `// Settings.` for `IOptionsMonitor<T>`, and `// State.` for rare mutable state.

## 4. Constructor

Write one primary constructor, with no overloads or static factories. With two or more parameters, put each on its own line, indented eight spaces deeper than the signature line. The closing `)` sits on its own line, at the signature line's indent. The body opens with a section comment naming what gets assigned, then assigns directly. `ArgumentNullException` guards on injected dependencies are optional. Construct AutoMapper inline under `// Save Mapper.`.

## 5. Method Declarations

Async method names end in `Async`. `CancellationToken` is the last parameter. A multi-parameter method puts each parameter on its own line at a four-space indent, with the closing `)` on its own line at the signature's indent. Add no method-level attributes except where required, such as a MediatR handler signature.

## 6. Method Body Sections

This is the heart of the style. A method body is a sequence of sections, each under a `// Title.` comment naming what the next block does, not what it did or why.

- Comments are Title Case and end with a period: `// Validate Parameters.`
- Prefer one blank line before each section comment.
- A comment is a short, imperative statement of the next block's intent, a reading aid for someone scanning. The test is intent, not vocabulary: `// Abort if we don't have a Valid VIN, make no changes.` is in-voice, the incidental "we" included. Avoid "Now we...", "Here we..." and "This will...".
- A comment never explains history, decisions, alternatives weighed or issues met. A WHY comment is rare.

Common section comments: `// Validate Parameters.` for guard clauses, `// Return Value.` for the return variable, `// Declare Variables.` for locals used across try blocks, `// Get X.` / `// Extract X.` / `// Build X.` / `// Apply X.` for major operations, and `// Return the Processed Result.` at the bottom.

Body conventions:
- Return early on null or invalid input: `if (document is null) return default;`
- Return `default`, not `null`, on nullable types.
- `is null` / `is not null` over `== null` / `!= null`.
- `??=` for default assignment: `filledDocument ??= new();`
- `var` when the right-hand side makes the type obvious.
- LINQ method chains, not query syntax.
- Collection expressions and spreads: `[.. source.Where(...)]` over `.ToArray()`, `[item]` over `new[] { item }`, `[.. existing, item]` over `Append`/`Concat` + `ToArray`.
- Named-type object initializers keep explicit parens: `new FilledForm() { Title = docType }`, not `new FilledForm { Title = docType }`. Target-typed `new()` stays preferred where the type is inferable.
- String interpolation `$"..."` over `string.Format` or concatenation.

The comments alone should tell the story of the method.

## 7. Async Patterns

Pass cancellation tokens down the call chain. A synchronous helper keeps its `Task<T>` signature for interface uniformity and returns `Task.FromResult(...)`, or `Task.CompletedTask` for `Task`. Use `ConfigureAwait(false)` in background services (`Services/Background/*`), not regular services, matching the surrounding file. Return `Task` or `Task<T>`, never `ValueTask`.

## 8. Logging

Log through injected `ILogger<T>`, preferred for new code, or Serilog's static `Log`, matching the surrounding file. The rules below apply to both. Add `using Serilog;` when the static `Log` is used. Catch blocks log in this shape:
```csharp
catch (Exception ex)
{
    Log.Error(ex, "Failure Processing Document.");
}
```
Output services trace with method-name-prefixed `Log.Debug($"...")`: `Log.Debug($"Acme.Documents.PdfService.CreateFromHtmlAsync called with Html: {html}");`. Log messages end in a period.

## 9. Exception Handling

The dominant shape is `try { ... } catch (Exception ex) { Log.Error(...); }`, where the catch logs and the method returns `default`. Background services add a `finally` for delay or sleep loops. Use `throw;` only when the exception must propagate, and never `throw ex;`. Define no custom exception types. Use the generic `Exception`.

## 10. Null Handling

Enable nullable reference types (`<Nullable>enable</Nullable>` in the csproj). Annotate returns and parameters nullable where null is a valid value: `Task<FilledForm?>`, `Stream?`. Discard an unused return: `_ = values.TryGetValue("Key", out var value);`. Use `??` chains for fallbacks. Never use the null-forgiving operator `!`. Use null-conditional and null-coalescing instead.

## 11. DI Registration

`Assembly/RegisterServices.cs` is the library's Autofac module, and every type registers the same way. Group registrations by domain under uppercase label comments. Each label ends with a period, like every other label comment:

```csharp
// HANDLERS.
builder.RegisterType<AzureFileSaveHandler>()
       .AsImplementedInterfaces()
       .PreserveExistingDefaults();
```

For settings, inject `IOptionsMonitor<TSettings>`, not `IOptions<T>`, and read `.CurrentValue` at use time.

## 12. Naming Conventions

Type suffixes: `Service` for core operations and orchestration, `Handler` for MediatR notification handlers, `Helper` for static utility methods, `Notification` for MediatR notifications, and `Repository` only for legacy data-access objects.

Method verb prefixes: `Get*` reads or fetches, `Process*` orchestrates a pipeline, `Create*` builds a new value, `Extract*` pulls data from a structure, `Build*` constructs a complex output, and `Save*` or `Set*` writes or assigns.

Interfaces take an `I` prefix matching the implementation.

## 13. MediatR Notifications

Notifications are simple data holders:

```csharp
public class FileSaveNotification : INotification
{
    public string Caller { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public CancellationToken CancellationToken { get; set; }
}
```

Handlers implement `INotificationHandler<T>` and live in `Handlers/`.

Publish with the notification built inline. Set `Caller = nameof(...)` on it. Handlers read `Caller` to know who fired it:
```csharp
await _mediator.Publish(
    new MessageProcessedNotification
    {
        Caller = nameof(FormService),
        Message = message,
        FilledForm = filledForm,
        CancellationToken = cancellationToken
    }
);
```

## 14. Models and Settings

Models live under `Models/` by purpose: `Models/Database/` for DB-shaped data, `Models/Documents/` for domain documents and forms, `Models/Email/` for email shapes, and `Models/Settings/` for `IOptionsMonitor<T>` settings classes.

Settings classes are plain DTOs with `{ get; set; }` auto-properties, never records. Property init values use collection expressions where natural:
```csharp
public List<byte[]> Images { get; set; } = [];
public List<Tuple<string, string>> Tokens { get; set; } = [];
public string FormCode { get; set; } = string.Empty;
public FilledForm FilledForm { get; set; } = new();
```

## 15. New Service Placement

For a brand-new service in `Services/Build/` or `Services/Process/`, start from the section 2 skeleton. Register it in `Assembly/RegisterServices.cs` under a label such as `// SERVICES.`. Declare its interface in `Interfaces/`.
