using System.Text.Json;

namespace WealthWatcher.Api.Models;

/// <summary>
/// Validation and canonicalisation rules for the local milestone settings
/// document. Progress is deliberately not persisted; it is derived from the
/// dashboard total in the browser.
/// </summary>
public static class MilestoneSettingsPolicy
{
    public const int MaxTargets = 50;
    public const string DefaultJson = "{\"targets\":[]}";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static bool TryNormalize(
        string? json,
        out string normalizedJson,
        out string? error)
    {
        normalizedJson = DefaultJson;
        error = null;

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? string.Empty : json);
        }
        catch (JsonException)
        {
            error = "Milestone settings must be valid JSON.";
            return false;
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                error = "Milestone settings must be a JSON object.";
                return false;
            }

            var targetsProperty = document.RootElement.EnumerateObject()
                .FirstOrDefault(property => property.Name.Equals("targets", StringComparison.OrdinalIgnoreCase));
            if (targetsProperty.Value.ValueKind == JsonValueKind.Undefined)
            {
                error = "Milestone targets are required.";
                return false;
            }

            if (targetsProperty.Value.ValueKind != JsonValueKind.Array)
            {
                error = "Milestone targets must be an array.";
                return false;
            }

            var targets = new List<decimal>();
            foreach (var targetElement in targetsProperty.Value.EnumerateArray())
            {
                if (targetElement.ValueKind != JsonValueKind.Number || !targetElement.TryGetDecimal(out var target))
                {
                    error = "Milestone targets must be numeric GBP amounts.";
                    return false;
                }

                if (target <= 0)
                {
                    error = "Milestone targets must be greater than £0.";
                    return false;
                }

                if (decimal.Round(target, 2) != target)
                {
                    error = "Milestone targets can have no more than two decimal places.";
                    return false;
                }

                targets.Add(target);
            }

            if (targets.Count > MaxTargets)
            {
                error = $"You can configure up to {MaxTargets} milestones.";
                return false;
            }

            targets.Sort();
            for (var index = 1; index < targets.Count; index++)
            {
                if (targets[index] == targets[index - 1])
                {
                    error = "Milestone targets must be unique.";
                    return false;
                }
            }

            normalizedJson = JsonSerializer.Serialize(new MilestoneSettingsDocument(targets), JsonOptions);
            return true;
        }
    }
}

public sealed record MilestoneSettingsDocument(IReadOnlyList<decimal> Targets);
