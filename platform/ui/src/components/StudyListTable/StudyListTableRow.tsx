import React from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import getGridWidthClass from '../../utils/getGridWidthClass';
import { Icons } from '@ohif/ui-next';

const StudyListTableRow = props => {
  const { tableData } = props;
  const { row, expandedContent, onClickRow, isExpanded, dataCY, clickableCY } = tableData;
  return (
    <>
      <tr
        className="select-none"
        data-cy={dataCY}
      >
        <td className="border-0 p-0">
          <table className="w-full">
            <tbody>
              <tr
                className={classnames(
                  'cursor-pointer transition-colors duration-150',
                  'border-b border-secondary-light',
                  'hover:bg-secondary-active',
                  {
                    'bg-secondary-main': isExpanded,
                  }
                )}
                onClick={onClickRow}
                data-cy={clickableCY}
              >
                {row.map((cell, index) => {
                  const { content, title, gridCol } = cell;
                  return (
                    <td
                      key={index}
                      className={classnames(
                        'truncate px-4 py-3.5 text-base font-normal text-white',
                        getGridWidthClass(gridCol) || ''
                      )}
                      style={{
                        maxWidth: 0,
                      }}
                      title={title}
                    >
                      <div className="flex items-center text-white">
                        {index === 0 && (
                          <div className="mr-3 flex-shrink-0">
                            {isExpanded ? (
                              <Icons.ChevronOpen className="inline-flex text-primary-active" />
                            ) : (
                              <Icons.ChevronClosed className="inline-flex rotate-180 text-common-light" />
                            )}
                          </div>
                        )}
                        <div className={classnames('min-w-0 text-white', { truncate: true })}>{content}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              {isExpanded && (
                <tr className="border-b border-secondary-light bg-secondary-dark">
                  <td
                    colSpan={row.length}
                    className="px-4 py-3 text-white"
                  >
                    {expandedContent}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
};

StudyListTableRow.propTypes = {
  tableData: PropTypes.shape({
    row: PropTypes.arrayOf(
      PropTypes.shape({
        key: PropTypes.string.isRequired,
        content: PropTypes.node,
        title: PropTypes.string,
        gridCol: PropTypes.number.isRequired,
      })
    ).isRequired,
    expandedContent: PropTypes.node.isRequired,
    onClickRow: PropTypes.func.isRequired,
    isExpanded: PropTypes.bool.isRequired,
    dataCY: PropTypes.string,
    clickableCY: PropTypes.string,
  }),
};

export default StudyListTableRow;
