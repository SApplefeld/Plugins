---
name: csharp-style
description: "The operator's C# house style. Use whenever writing or modifying ANY C# code: new services, handlers, helpers, MediatR notifications, models, DI registration, or refactoring existing C#. Signature traits: #region organization, section comments ending in periods, grouped fields with label comments. Trigger on any C# work even when style is not named."
---

# C# Style

Read [references/csharp-style.md](references/csharp-style.md), the full pattern reference, before writing code.

## Core Philosophy

1. **Comments are visual structure.** A short `// Title.` comment heads each block as its section header. **Every section comment ends with a period.** It states imperatively what the next block does: "Validate Parameters." not "Now we check the inputs". Judge intent, not vocabulary: `// Abort if we don't have a Valid VIN, make no changes.` is in-voice. A comment never explains history, decisions, alternatives weighed or issues met. A WHY comment is rare, and its reason follows as its own sentence.
2. **Idempotent by default.** Code never breaks on re-execution.
3. **Section banners over inline narration.** `#region Title` / `#endregion` organize every class.
4. **Find a sibling and mimic it.** When in doubt, follow the layout of an existing file of similar shape exactly. A sibling never takes you out of this style in a foreign repo. With no sibling, use the exemplar below and the reference's section 1 file structure and section 2 skeleton.

## Precedence

The doctrine's house-style rule under Defaults decides when a repo's own contract overrides this style.

## Method Exemplar

```csharp
public async Task<Widget?> ProcessWidgetAsync(
    WidgetRequest request,
    CancellationToken cancellationToken
)
{
    // Validate Parameters.
    if (request is null) return default;

    // Return Value.
    Widget? widget = default;

    try
    {
        // Get Widget from API.
        widget = await _widgetService.GetWidgetAsync(request.Id, cancellationToken);

        // Apply Defaults.
        widget ??= new();
        widget.ProcessedAt = DateTimeOffset.UtcNow;
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Failure Processing Widget.");
    }

    // Return the Processed Widget.
    return widget;
}
```

The comments alone should tell the story of the method.

## Outlining a large file

To find one thing in a C# file past roughly 1,000 lines, outline it with three greps, each with line numbers:

- Types: `^\s*((public|private|protected|internal|sealed|static|abstract|partial|readonly|file)\s+)*(class|interface|record|struct|enum)\s+\w`
- Members: `^\s*(public|private|protected|internal)\b.*\(`, piped through `grep -vE '^[^(]*= '` and `grep -v '{ get'`
- Regions: `^\s*#region`, taken verbatim

A positional record or primary constructor shows in both lists, counted once. Take `#region` labels verbatim. In canonical region order they are the whole map.

## Antipatterns

- ❌ Block-scoped namespaces in *new* files - a new file that declares a namespace uses file-scoped (`namespace X;`), and existing block-scoped files are left alone
- ❌ Fine-grained namespaces - keep them coarse and minimal, one root namespace per project where warranted, and never map folders to sub-namespaces
- ❌ Removing `#region` blocks because "modern style" dislikes them
- ❌ The null-forgiving operator `!` - use null-conditional and null-coalescing instead
- ❌ Inline SQL text in application code - call the stored procedure with `CommandType.StoredProcedure`, per the doctrine's Defaults
- ❌ Resolving configuration options once at startup instead of lazily at request time
- ❌ Ordering middleware by convenience rather than cost - cheap rejection (rate limiting) belongs before expensive work (authentication)

## Completion Checklist

- [ ] Each major section wrapped in `#region` / `#endregion`; canonical order: Constants → Variables → Constructor → public method-group regions → Private Methods
- [ ] Private fields `_camelCase`, `readonly` for injected dependencies, grouped with `// Group.` labels
- [ ] Constructor parameters one per line when 2+, eight spaces deeper than the signature line, closing `)` on its own line at the signature line's indent, body starts `// Save Services.`
- [ ] Section comments inside methods use `// Title.`, never `// Save Services`; blank line before each
- [ ] Early returns with `default` (not `null`); `is null` / `is not null`; `??=` for late-init
- [ ] Collection expressions and spreads, such as `[.. existing, item]` not `Append`/`Concat` + `ToArray`
- [ ] `Async` suffix on every `Task` and `Task<T>` method; `CancellationToken` last and passed down the chain
- [ ] `using` lines: System.* first, then project and third-party namespaces, third-party where convenient (reference §1), no blank lines between groups
- [ ] Logging via `ILogger<T>` (preferred) or the static Serilog `Log` (common in existing code); messages end with a period: `logger.LogError(ex, "Message.")` or `Log.Error(ex, "Message.")`
- [ ] DI registration in `Assembly/RegisterServices.cs`: `.AsImplementedInterfaces().PreserveExistingDefaults()`, grouped by domain label
- [ ] Class declares its interface inline: `public class FooService : IFooService`; interface in `Interfaces/IFooService.cs`
- [ ] XML `/// <summary>` docs on public members only where they earn their keep
