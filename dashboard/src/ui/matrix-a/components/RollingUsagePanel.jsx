import React from "react";
import { copy } from "../../../lib/copy";
import { formatCompactNumber } from "../../../lib/format";

export const RollingUsagePanel = React.memo(function RollingUsagePanel({
  rolling,
  className = "",
}) {
  const placeholder = copy("shared.placeholder.short");
  const compactConfig = {
    thousandSuffix: copy("shared.unit.thousand_abbrev"),
    millionSuffix: copy("shared.unit.million_abbrev"),
    billionSuffix: copy("shared.unit.billion_abbrev"),
  };
  const formatValue = (value) => {
    if (value == null) return placeholder;
    const formatted = formatCompactNumber(value, compactConfig);
    return formatted === "-" ? placeholder : formatted;
  };

  const items = [
    {
      key: "last_7d",
      label: copy("dashboard.rolling.last_7d"),
      value: formatValue(rolling?.last_7d?.totals?.billable_total_tokens),
    },
    {
      key: "last_30d",
      label: copy("dashboard.rolling.last_30d"),
      value: formatValue(rolling?.last_30d?.totals?.billable_total_tokens),
    },
    {
      key: "avg_active_day",
      label: copy("dashboard.rolling.avg_active_day"),
      value: formatValue(rolling?.last_30d?.avg_per_active_day),
    },
  ];

  return (
    <div className={`rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5 ${className}`}>
      <div className="mb-3">
        <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">
          {copy("dashboard.rolling.title")}
        </h3>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.key} className="text-center">
            <div className="text-xs text-oai-gray-500 dark:text-oai-gray-300 mb-0.5">{item.label}</div>
            <div className="text-lg font-semibold text-oai-black dark:text-oai-white tabular-nums">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
