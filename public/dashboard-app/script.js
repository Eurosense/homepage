document.addEventListener("DOMContentLoaded", function () {
    const colors = ["#133BC7", "#FDC220", "#1BBE6F", "#E63E12", "#502379"];
    // Refreshed nightly and published to GitHub Pages, so new captures appear
    // without rebuilding and redeploying the site. The copy committed next to
    // this file is the fallback: it keeps the dashboard working offline, on a
    // preview build, and if Pages is unreachable.
    const LIVE_DATA_URL = "https://eurosense.github.io/homepage/captures.csv";

    async function fetchCsvText() {
      try {
        const live = await fetch(LIVE_DATA_URL, { cache: "no-cache" });
        if (live.ok) {
          const text = await live.text();
          if (text.startsWith("id,project_id,")) return text;
          console.warn("Live captures data did not look like a CSV export; using the bundled copy.");
        }
      } catch (error) {
        console.warn("Live captures data unreachable; using the bundled copy.", error);
      }
      const local = await fetch("./captures.csv");
      if (!local.ok) throw new Error(`Failed to fetch the CSV file: ${local.statusText}`);
      return local.text();
    }

    async function loadCSVData() {
      try {
        const csvText = await fetchCsvText();
        const jsonData = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true
        }).data;
        return jsonData;
      } catch (error) {
        console.error("Error loading CSV data:", error);
      }
    }
    function replaceLongStrings(input) {
      if (input && input.length > 15) {
        return "Other";
      }
      return input || "Not specified";
    }
    function getCountryCode(countryName) {
      const countryCodes = {
        Austria: "AT",
        Belgium: "BE",
        Bulgaria: "BG",
        Croatia: "HR",
        Cyprus: "CY",
        Czechia: "CZ",
        Denmark: "DK",
        Estonia: "EE",
        Finland: "FI",
        France: "FR",
        Germany: "DE",
        Greece: "GR",
        Hungary: "HU",
        Ireland: "IE",
        Italy: "IT",
        Latvia: "LV",
        Lithuania: "LT",
        Luxembourg: "LU",
        Malta: "MT",
        Netherlands: "NL",
        Poland: "PL",
        Portugal: "PT",
        Romania: "RO",
        Slovakia: "SK",
        Slovenia: "SI",
        Spain: "ES",
        Sweden: "SE",
        "United Kingdom": "GB",
        Others: "EU"
      };
      return countryCodes[countryName.trim()] || null;
    }
    function getTop5PlusOthers(countsObj) {
      const sorted = Object.entries(countsObj).sort((a, b) => b[1] - a[1]);
      const top5 = sorted.slice(0, 5);
      const others = sorted.slice(5);
      const othersSum = others.reduce((acc, [_, val]) => acc + val, 0);
      const newDataObj = {};
      top5.forEach(([key, val]) => {
        newDataObj[key] = val;
      });
      if (othersSum > 0) {
        newDataObj["Others"] = othersSum;
      }
      return newDataObj;
    }
    function assignNonConsecutiveColors(dataLength, colorArray) {
      const result = [];
      let lastColor = null;
      let colorIndex = 0;
      for (let i = 0; i < dataLength; i++) {
        let color = colorArray[colorIndex];
        if (color === lastColor) {
          colorIndex = (colorIndex + 1) % colorArray.length;
          color = colorArray[colorIndex];
        }
        result.push(color);
        lastColor = color;
        colorIndex = (colorIndex + 1) % colorArray.length;
      }
      return result;
    }
    function createCharts(data) {
      if (data.length === 0) {
        console.error("CSV data is empty.");
        return;
      }
      const csvColumns = Object.keys(data[0]);
      console.log("Available CSV Columns:", csvColumns);
      const experienceFrequencyCounts = {};
      const countryCounts = {};
      const genderCounts = {};
      const ageGroupCounts = {};
      data.forEach((row) => {
        const experience = replaceLongStrings(row["6.3 The experience you described was..."]);
        experienceFrequencyCounts[experience] = (experienceFrequencyCounts[experience] || 0) + 1;
        const country = replaceLongStrings(row["6.4 My experience is from..."]);
        if (country.trim() !== "" && country.trim() !== "Not specified") {
          countryCounts[country.trim()] = (countryCounts[country.trim()] || 0) + 1;
        }
        const gender = replaceLongStrings(row["6.5 I identify as..."]);
        genderCounts[gender] = (genderCounts[gender] || 0) + 1;
        const ageGroup = replaceLongStrings(row["6.6 I am ..."]);
        ageGroupCounts[ageGroup] = (ageGroupCounts[ageGroup] || 0) + 1;
      });
      const experienceFrequencyData = Object.entries(experienceFrequencyCounts).map(([name, value]) => ({
        name,
        value
      }));
      const totalCountries = Object.values(countryCounts).reduce((a, b) => a + b, 0);
      const fullCountryData = Object.entries(countryCounts).map(([name, value]) => ({
        value: ((value / totalCountries) * 100).toFixed(2),
        name,
        code: getCountryCode(name)
      }));
      const top5CountryCounts = getTop5PlusOthers(countryCounts);
      const top5CountryData = Object.entries(top5CountryCounts).map(([name, value]) => ({
        name,
        value
      }));
      const genderData = Object.entries(genderCounts).map(([name, value]) => ({
        name,
        value
      }));
      const ageGroupData = Object.entries(ageGroupCounts).map(([name, value]) => ({
        name,
        value
      }));
      const barChartsData = [
        {
          id: "barChart1",
          title: "2.1 In the experience you shared, what matters most are...",
          leftLabel: "Values and traditions",
          rightLabel: "Change and innovation",
          xAxisData: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
          yAxisValues: [1, 0, 2, 1, 1, 2, 1, 3, 2, 5]
        },
        {
          id: "barChart2",
          title: "2.2 In the experience you shared, others behave...",
          leftLabel: "As expected",
          rightLabel: "Unusually",
          xAxisData: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
          yAxisValues: [2, 1, 1, 4, 5, 2, 1, 2, 1, 3]
        },
        {
          id: "barChart3",
          title: "2.3 In the experience you shared, everybody is treated...",
          leftLabel: "The same but it's not ok",
          rightLabel: "Differently but it's not ok",
          xAxisData: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
          yAxisValues: [1, 2, 0, 1, 0, 2, 3, 5, 2, 4]
        },
        {
          id: "barChart4",
          title: "2.4 In the experience you shared, you feel the government...",
          leftLabel: "Interferes too much",
          rightLabel: "Doesn't care at all",
          xAxisData: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
          yAxisValues: [0, 1, 1, 2, 3, 1, 2, 6, 3, 5]
        }
      ];
      barChartsData.forEach((cfg) => {
        const barChart = echarts.init(document.getElementById(cfg.id));
        barChart.setOption({
          title: {
            text: cfg.title,
            left: "left",
            textStyle: {
              fontFamily: "Inter, sans-serif"
            }
          },
          tooltip: {
            trigger: "axis"
          },
          xAxis: {
            type: "category",
            data: cfg.xAxisData,
            axisLabel: {
              formatter: function (val, idx) {
                if (idx === 0) return cfg.leftLabel;
                if (idx === cfg.xAxisData.length - 1) return cfg.rightLabel;
                return val;
              }
            }
          },
          yAxis: {
            type: "value",
            name: "Times Answered"
          },
          series: [
            {
              data: cfg.yAxisValues,
              type: "bar",
              itemStyle: {
                color: "#5B53F6"
              },
              barMaxWidth: 30
            }
          ]
        });
      });
      function buildPieData(originalData) {
        const assignedColors = assignNonConsecutiveColors(originalData.length, colors);
        return originalData.map((item, i) => ({
          name: item.name,
          value: item.value,
          itemStyle: { color: assignedColors[i] }
        }));
      }
      const experiencePieData = buildPieData(experienceFrequencyData);
      const countryPieData = buildPieData(top5CountryData);
      const genderPieData = buildPieData(genderData);
      const agePieData = buildPieData(ageGroupData);
      const chartData = [
        {
          id: "chart1",
          title: "6.3 The experience you described was...",
          data: experiencePieData
        },
        {
          id: "chart2",
          title: "6.4 My experience is from (Top 5 + Others)...",
          data: countryPieData
        },
        {
          id: "chart3",
          title: "6.5 I identify as...",
          data: genderPieData
        },
        {
          id: "chart4",
          title: "6.6 I am ...",
          data: agePieData
        }
      ];
      chartData.forEach(({ id, title, data }) => {
        const chart = echarts.init(document.getElementById(id));
        chart.setOption({
          title: {
            text: title,
            left: "left",
            textStyle: {
              fontFamily: "Inter, sans-serif"
            }
          },
          tooltip: { trigger: "item" },
          series: [
            {
              name: title,
              type: "pie",
              radius: "65%",
              center: ["50%", "50%"],
              data,
              emphasis: {
                itemStyle: {
                  shadowBlur: 10,
                  shadowOffsetX: 0,
                  shadowColor: "rgba(0, 0, 0, 0.5)"
                }
              },
              label: { formatter: "{b}\n({d}%)" }
            }
          ]
        });
      });
      fetch("./europe.topo.json")
        .then((response) => response.json())
        .then((topology) => {
          Highcharts.mapChart("europeMap", {
            chart: {
              map: topology
            },
            title: {
              text: "6.4 My experience is from...",
              align: "left",
              style: { fontFamily: "Inter, sans-serif" }
            },
            mapNavigation: {
              enabled: true,
              buttonOptions: { verticalAlign: "bottom" }
            },
            colorAxis: {
              min: 0,
              max: 100,
              type: "linear",
              stops: [
                [0, "#133BC7"],
                [0.25, "#FDC220"],
                [0.5, "#1BBE6F"],
                [0.75, "#E63E12"],
                [1, "#502379"]
              ]
            },
            tooltip: {
              formatter: function () {
                const point = this.point;
                const dataPoint = fullCountryData.find((d) => d.code === point["iso-a2"]);
                return `${point.name}: ${dataPoint ? dataPoint.value + "%" : "0%"}`;
              }
            },
            series: [
              {
                data: fullCountryData,
                name: "Experience Percentage",
                states: { hover: { color: "#BADA55" } },
                dataLabels: { enabled: false },
                joinBy: ["iso-a2", "code"]
              }
            ]
          });
        });
      createTernaryChart1(data);
      createTernaryChart2(data);
      createTernaryChart3(data);
      createTernaryChart4(data);
    }
    function createTernaryChart1(data) {
      const indicators = ["past", "future", "present"];
      const matchedColumns = indicators.map((indicator) =>
        Object.keys(data[0]).find((col) => col.toLowerCase().includes(indicator))
      );
      if (matchedColumns.includes(undefined)) {
        console.error("Could not find Past, Present, and Future columns in the CSV data.");
        console.log("Available columns:", Object.keys(data[0]));
        return;
      }
      let aValues = [];
      let bValues = [];
      let cValues = [];
      data.forEach((row) => {
        const pastVal = parseFloat((row[matchedColumns[0]] || "").replace(",", "."));
        const futureVal = parseFloat((row[matchedColumns[1]] || "").replace(",", "."));
        const presentVal = parseFloat((row[matchedColumns[2]] || "").replace(",", "."));
        if (!isNaN(pastVal) && !isNaN(futureVal) && !isNaN(presentVal)) {
          aValues.push(pastVal);
          bValues.push(futureVal);
          cValues.push(presentVal);
        }
      });
      if (aValues.length === 0) {
        console.error("No valid Past/Future/Present data to plot.");
        return;
      }
      const trace = {
        type: "scatterternary",
        mode: "markers",
        a: aValues,
        b: bValues,
        c: cValues,
        name: "Points",
        marker: {
          symbol: "circle",
          color: "#6B4EE8",
          size: 8,
          line: { width: 1, color: "#333" },
          opacity: 0.8
        },
        text: data.map((_, i) => `Row ${i + 1}`),
        hovertemplate:
          "Past: %{a:.2f}<br>Future: %{b:.2f}<br>Present: %{c:.2f}<extra></extra>"
      };
      const layout = {
        title: {
          text: "3.1 The experience you shared relates to...",
          font: { family: "Inter, sans-serif", size: 16 },
          x: 0
        },
        ternary: {
          sum: 100,
          aaxis: { title: "Past" },
          baxis: { title: "Future" },
          caxis: { title: "Present" }
        },
        margin: { l: 50, r: 50, b: 50, t: 80 }
      };
      Plotly.newPlot("ternaryChart", [trace], layout);
      window.addEventListener("resize", () => {
        Plotly.Plots.resize(document.getElementById("ternaryChart"));
      });
    }
    function createTernaryChart2(data) {
  const countryKey = "3.2 The experience you shared relates to..._Your country";
  const europeKey = "3.2 The experience you shared relates to..._Europe";
  const regionKey = "3.2 The experience you shared relates to..._Your region";

  let aValues = [];
  let bValues = [];
  let cValues = [];

  data.forEach((row) => {
    const a = parseFloat((row[countryKey] || "").replace(",", "."));
    const b = parseFloat((row[europeKey] || "").replace(",", "."));
    const c = parseFloat((row[regionKey] || "").replace(",", "."));
    if (!isNaN(a) && !isNaN(b) && !isNaN(c)) {
      aValues.push(a);
      bValues.push(b);
      cValues.push(c);
    }
  });

  if (aValues.length === 0) {
    console.error("No valid values for 3.2 to plot.");
    return;
  }

  const trace = {
    type: "scatterternary",
    mode: "markers",
    a: aValues,
    b: bValues,
    c: cValues,
    marker: {
      symbol: "circle",
      color: "#6B4EE8",
      size: 8,
      line: { width: 1, color: "#333" },
      opacity: 0.8
    },
    hovertemplate:
      "Your Country: %{a:.2f}<br>Europe: %{b:.2f}<br>Your Region: %{c:.2f}<extra></extra>"
  };

  const layout = {
    title: {
      text: "3.2 The experience you shared relates to...",
      font: { family: "Inter, sans-serif", size: 16 },
      x: 0
    },
    ternary: {
      sum: 100,
      aaxis: { title: "Your country" },
      baxis: { title: "Europe" },
      caxis: { title: "Your region" }
    },
    margin: { l: 50, r: 50, b: 50, t: 80 }
  };

  Plotly.newPlot("ternaryChart2", [trace], layout);
  window.addEventListener("resize", () => {
    Plotly.Plots.resize(document.getElementById("ternaryChart2"));
  });
}

function createTernaryChart3(data) {
    const actionKey = "3.3 In the experience you shared, democracy shows up as..._I want to take action";
    const politiciansKey = "3.3 In the experience you shared, democracy shows up as..._I want politicians to take action";
    const aloneKey = "3.3 In the experience you shared, democracy shows up as..._I want to be left alone ";
  
    let aValues = [];
    let bValues = [];
    let cValues = [];
  
    data.forEach((row) => {
      const a = parseFloat((row[actionKey] || "").replace(",", "."));
      const b = parseFloat((row[politiciansKey] || "").replace(",", "."));
      const c = parseFloat((row[aloneKey] || "").replace(",", "."));
      if (!isNaN(a) && !isNaN(b) && !isNaN(c)) {
        aValues.push(a);
        bValues.push(b);
        cValues.push(c);
      }
    });
  
    if (aValues.length === 0) {
      console.error("No valid values for 3.3 to plot.");
      return;
    }
  
    const trace = {
      type: "scatterternary",
      mode: "markers",
      a: aValues,
      b: bValues,
      c: cValues,
      marker: {
        symbol: "circle",
        color: "#6B4EE8",
        size: 8,
        line: { width: 1, color: "#333" },
        opacity: 0.8
      },
      hovertemplate:
        "I want to take action: %{a:.2f}<br>I want politicians to take action: %{b:.2f}<br>I want to be left alone: %{c:.2f}<extra></extra>"
    };
  
    const layout = {
      title: {
        text: "3.3 In the experience you shared, democracy shows up as...",
        font: { family: "Inter, sans-serif", size: 16 },
        x: 0
      },
      ternary: {
        sum: 100,
        aaxis: { title: "I want to take action" },
        baxis: { title: "I want politicians to take action" },
        caxis: { title: "I want to be left alone" }
      },
      margin: { l: 50, r: 50, b: 50, t: 80 }
    };
  
    Plotly.newPlot("ternaryChart3", [trace], layout);
    window.addEventListener("resize", () => {
      Plotly.Plots.resize(document.getElementById("ternaryChart3"));
    });
  }
  
  function createTernaryChart4(data) {
    const changeKey = "3.4 In the experience you shared, your concern is..._Everything is changing ";
    const backwardKey = "3.4 In the experience you shared, your concern is..._We move backwards";
    const nothingKey = "3.4 In the experience you shared, your concern is..._Nothing changes";
  
    let aValues = [];
    let bValues = [];
    let cValues = [];
  
    data.forEach((row) => {
      const a = parseFloat((row[changeKey] || "").replace(",", "."));
      const b = parseFloat((row[backwardKey] || "").replace(",", "."));
      const c = parseFloat((row[nothingKey] || "").replace(",", "."));
      if (!isNaN(a) && !isNaN(b) && !isNaN(c)) {
        aValues.push(a);
        bValues.push(b);
        cValues.push(c);
      }
    });
  
    if (aValues.length === 0) {
      console.error("No valid values for 3.4 to plot.");
      return;
    }
  
    const trace = {
      type: "scatterternary",
      mode: "markers",
      a: aValues,
      b: bValues,
      c: cValues,
      marker: {
        symbol: "circle",
        color: "#6B4EE8",
        size: 8,
        line: { width: 1, color: "#333" },
        opacity: 0.8
      },
      hovertemplate:
        "Everything is changing: %{a:.2f}<br>We move backwards: %{b:.2f}<br>Nothing changes: %{c:.2f}<extra></extra>"
    };
  
    const layout = {
      title: {
        text: "3.4 In the experience you shared, your concern is...",
        font: { family: "Inter, sans-serif", size: 16 },
        x: 0
      },
      ternary: {
        sum: 100,
        aaxis: { title: "Everything is changing" },
        baxis: { title: "We move backwards" },
        caxis: { title: "Nothing changes" }
      },
      margin: { l: 50, r: 50, b: 50, t: 80 }
    };
  
    Plotly.newPlot("ternaryChart4", [trace], layout);
    window.addEventListener("resize", () => {
      Plotly.Plots.resize(document.getElementById("ternaryChart4"));
    });
  }
  
    loadCSVData().then((jsonData) => {
      if (jsonData) {
        createCharts(jsonData);
      }
    });
    window.addEventListener("resize", function () {
      [
        "barChart1",
        "barChart2",
        "barChart3",
        "barChart4",
        "chart1",
        "chart2",
        "chart3",
        "chart4"
      ].forEach((id) => {
        const chartInstance = echarts.getInstanceByDom(document.getElementById(id));
        if (chartInstance) {
          chartInstance.resize();
        }
      });
      ["ternaryChart","ternaryChart2","ternaryChart3","ternaryChart4"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          Plotly.Plots.resize(el);
        }
      });
      Highcharts.charts.forEach((chart) => chart?.reflow());
    });
  });