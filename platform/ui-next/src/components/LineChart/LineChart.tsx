import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import * as d3Selection from 'd3-selection';
import { lineChart } from './d3LineChart';
import './LineChart.css';

const LineChart = ({
  width: widthProp,
  height: heightProp,
  axis,
  series,
  showAxisLabels = true,
  showAxisGrid = true,
  showLegend = false,
  legendWidth = 120,
  transparentChartBackground = false,
  containerClassName,
  chartContainerClassName,
}: {
  title: string;
  width: number;
  height: number;
  showAxisGrid: boolean;
  showAxisLabels: boolean;
  showLegend: boolean;
  legendWidth: number;
  transparentChartBackground: boolean;
  containerClassName: string;
  chartContainerClassName: string;
}): JSX.Element => {
  const chartContainerRef = useRef(null);
  const [d3SVGContainer, setD3SVGRef] = useState(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const chartContainer = chartContainerRef.current;
    const d3Container = d3Selection
      .create('svg')
      .attr('viewBox', [0, 0, chartContainer.offsetWidth, chartContainer.offsetHeight])
      .style('max-width', '100%')
      .style('overflow', 'visible');

    chartContainer.append(d3Container.node());

    setD3SVGRef(d3Container);

    // A one-shot offsetWidth/offsetHeight read here can race a still-settling
    // layout (e.g. this chart mounted inside a modal/dialog whose own size
    // isn't final on the very first synchronous layout pass) and capture
    // 0x0 - since this effect only ever runs once (chartContainerRef is a
    // stable ref), that 0x0 would stick forever and the chart silently never
    // draws anything, even though it received valid data. A ResizeObserver
    // re-measures whenever the container's real size changes (including the
    // very first time it settles to a non-zero size), so the chart always
    // ends up correctly sized regardless of what state its parent layout was
    // in at mount.
    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width: observedWidth, height: observedHeight } = entry.contentRect;
      setWidth(observedWidth);
      setHeight(observedHeight);
    });
    resizeObserver.observe(chartContainer);

    return () => resizeObserver.disconnect();
  }, [chartContainerRef]);

  useEffect(() => {
    if (!d3SVGContainer || !width || !height) {
      return;
    }

    // The SVG's own viewBox (its internal-coordinate-to-pixel mapping) was
    // only known at first render; keep it in sync with the ResizeObserver-
    // reported size above, otherwise a stale/zero viewBox from mount time
    // would clip everything addLineChartNode draws even though width/height
    // here are correct.
    d3SVGContainer.attr('viewBox', [0, 0, width, height]);

    lineChart.addLineChartNode({
      d3SVGRef: d3SVGContainer,
      axis,
      series,
      width,
      height,
      showAxisLabels,
      showAxisGrid,
      showLegend,
      legendWidth,
      transparentChartBackground,
    });
  }, [
    d3SVGContainer,
    axis,
    series,
    width,
    height,
    showAxisLabels,
    showAxisGrid,
    transparentChartBackground,
    showLegend,
    legendWidth,
  ]);

  return (
    <div
      className={classnames(
        'LineChart text-foreground',
        {
          [`w-[${widthProp}px]`]: !!widthProp,
          [`h-[${heightProp}px]`]: !!heightProp,
        },
        {
          'w-full': !widthProp,
          'h-full': !heightProp,
        },
        containerClassName
      )}
    >
      <div
        id="chartContainer"
        ref={chartContainerRef}
        className={classnames('h-full w-full', chartContainerClassName)}
      ></div>
    </div>
  );
};

LineChart.propTypes = {
  title: PropTypes.string,
  width: PropTypes.number,
  height: PropTypes.number,
  showAxisLabels: PropTypes.bool,
  showAxisGrid: PropTypes.bool,
  showLegend: PropTypes.bool,
  legendWidth: PropTypes.number,
  transparentChartBackground: PropTypes.bool,
  containerClassName: PropTypes.string,
  chartContainerClassName: PropTypes.string,
};

export default LineChart;
